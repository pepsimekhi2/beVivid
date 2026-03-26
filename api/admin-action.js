const { requireAdmin } = require('./_adminAuth');
const { del, get, patch, put } = require('./_firebaseAdmin');

function normalizeHandle(value) {
  return String(value || '').replace(/[^a-z0-9_]/gi, '').toLowerCase();
}

function toNumber(value, fallback = 0) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function encodeLayout(layout) {
  return Buffer.from(JSON.stringify(layout || {}), 'utf8').toString('base64');
}

function decodeLayout(value) {
  return JSON.parse(Buffer.from(String(value || ''), 'base64').toString('utf8'));
}

async function updatePostsForHandle(rootPath, oldHandle, newHandle, displayName) {
  const posts = await get(rootPath).catch(() => null);
  if (!posts || typeof posts !== 'object') return;

  const entries = Object.entries(posts);
  for (const [postId, postValue] of entries) {
    const post = Object.assign({}, postValue || {});
    let changed = false;

    if (post.authorHandle === oldHandle) {
      post.authorHandle = newHandle;
      if (displayName) post.authorDisplayName = displayName;
      changed = true;
    } else if (displayName && post.authorHandle === newHandle) {
      post.authorDisplayName = displayName;
      changed = true;
    }

    if (post.likes && typeof post.likes === 'object' && oldHandle !== newHandle && Object.prototype.hasOwnProperty.call(post.likes, oldHandle)) {
      post.likes[newHandle] = post.likes[oldHandle];
      delete post.likes[oldHandle];
      changed = true;
    }

    const comments = post.comments && typeof post.comments === 'object' ? post.comments : {};
    Object.values(comments).forEach(comment => {
      if (!comment || typeof comment !== 'object') return;
      if (comment.authorHandle === oldHandle) {
        comment.authorHandle = newHandle;
        if (displayName) comment.authorDisplayName = displayName;
        changed = true;
      } else if (displayName && comment.authorHandle === newHandle) {
        comment.authorDisplayName = displayName;
        changed = true;
      }
      const replies = comment.replies && typeof comment.replies === 'object' ? comment.replies : {};
      Object.values(replies).forEach(reply => {
        if (!reply || typeof reply !== 'object') return;
        if (reply.authorHandle === oldHandle) {
          reply.authorHandle = newHandle;
          if (displayName) reply.authorDisplayName = displayName;
          changed = true;
        } else if (displayName && reply.authorHandle === newHandle) {
          reply.authorDisplayName = displayName;
          changed = true;
        }
      });
    });

    if (changed) {
      await put(`${rootPath}/${postId}`, post);
    }
  }
}

async function renameSocialReferences(oldHandle, newHandle) {
  const social = await get('communityData/social').catch(() => null);
  if (!social || typeof social !== 'object') return;

  const updated = Object.assign({}, social);
  if (updated[oldHandle] && !updated[newHandle]) {
    updated[newHandle] = updated[oldHandle];
    delete updated[oldHandle];
  }

  Object.values(updated).forEach(entry => {
    if (!entry || typeof entry !== 'object') return;
    ['followers', 'following'].forEach(key => {
      const map = entry[key];
      if (!map || typeof map !== 'object' || !Object.prototype.hasOwnProperty.call(map, oldHandle) || oldHandle === newHandle) return;
      map[newHandle] = map[oldHandle];
      delete map[oldHandle];
    });
  });

  await put('communityData/social', updated);
}

async function renameNotificationBucket(oldHandle, newHandle) {
  if (oldHandle === newHandle) return;
  const notifications = await get(`communityData/notifications/${oldHandle}`).catch(() => null);
  if (!notifications) return;
  await put(`communityData/notifications/${newHandle}`, notifications);
  await del(`communityData/notifications/${oldHandle}`).catch(() => null);
}

async function renamePayoutRequests(oldHandle, newHandle, displayName, email) {
  const requests = await get('adminData/payoutRequests').catch(() => null);
  if (!requests || typeof requests !== 'object') return;
  for (const [id, request] of Object.entries(requests)) {
    if (!request || request.requesterHandle !== oldHandle) continue;
    await patch(`adminData/payoutRequests/${id}`, {
      requesterHandle: newHandle,
      requesterDisplayName: displayName || request.requesterDisplayName || newHandle,
      requesterEmail: email || request.requesterEmail || ''
    });
  }
}

async function moveNodeIfPresent(fromPath, toPath, mutate) {
  const current = await get(fromPath).catch(() => null);
  if (!current) return;
  const nextValue = typeof mutate === 'function' ? mutate(current) : current;
  await put(toPath, nextValue);
  await del(fromPath).catch(() => null);
}

async function renameUserHandle(oldHandle, newHandle, userRecord) {
  if (oldHandle === newHandle) return;

  const existingTarget = await get(`users/${newHandle}`).catch(() => null);
  if (existingTarget) {
    throw new Error('That replacement handle already exists.');
  }

  await put(`users/${newHandle}`, Object.assign({}, userRecord, { handle: newHandle }));
  await del(`users/${oldHandle}`).catch(() => null);

  await moveNodeIfPresent(`publicUserIndex/${oldHandle}`, `publicUserIndex/${newHandle}`, current => Object.assign({}, current, {
    handle: newHandle,
    displayName: userRecord.displayName || current.displayName || newHandle,
    updatedAt: Date.now()
  }));

  await moveNodeIfPresent(`profileAudio/${oldHandle}`, `profileAudio/${newHandle}`);
  await renameSocialReferences(oldHandle, newHandle);
  await renameNotificationBucket(oldHandle, newHandle);
  await renamePayoutRequests(oldHandle, newHandle, userRecord.displayName, userRecord.email);
  await updatePostsForHandle('communityData/posts', oldHandle, newHandle, userRecord.displayName);
  await updatePostsForHandle('communityPosts', oldHandle, newHandle, userRecord.displayName);
}

async function syncDisplayNameEverywhere(handle, displayName) {
  await patch(`publicUserIndex/${handle}`, {
    handle,
    displayName,
    updatedAt: Date.now()
  }).catch(() => null);
  await updatePostsForHandle('communityData/posts', handle, handle, displayName);
  await updatePostsForHandle('communityPosts', handle, handle, displayName);
}

async function clearProfileAudio(handle) {
  await del(`profileAudio/${handle}`).catch(() => null);
  await patch(`users/${handle}`, {
    profileSongReady: false,
    profileSongLabel: '',
    profileSongAudio: null,
    profileUpdatedAt: Date.now()
  });
}

async function clearProfileBlocks(handle) {
  const user = await get(`users/${handle}`);
  let encodedLayout = null;
  if (user && user.profileLayoutEncoded) {
    try {
      const layout = decodeLayout(user.profileLayoutEncoded);
      layout.elements = [];
      encodedLayout = encodeLayout(layout);
    } catch (_) {
      encodedLayout = null;
    }
  }

  await patch(`users/${handle}`, {
    profileLayoutEncoded: encodedLayout,
    profileUpdatedAt: Date.now()
  });
  await patch(`publicUserIndex/${handle}`, {
    profileImage: '',
    updatedAt: Date.now()
  }).catch(() => null);
}

async function replaceProfileText(handle, nextText) {
  const user = await get(`users/${handle}`);
  if (!user || !user.profileLayoutEncoded) {
    throw new Error('This user does not have a saved vivid page yet.');
  }

  const layout = decodeLayout(user.profileLayoutEncoded);
  let changed = 0;
  layout.elements = (layout.elements || []).map(element => {
    if (!element || element.type !== 'text') return element;
    changed += 1;
    return Object.assign({}, element, { text: nextText });
  });

  if (!changed) {
    throw new Error('There are no text blocks to replace on this vivid page.');
  }

  await patch(`users/${handle}`, {
    profileLayoutEncoded: encodeLayout(layout),
    profileUpdatedAt: Date.now()
  });
  return changed;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed.' });
    return;
  }

  if (!requireAdmin(req, res)) return;

  const action = String((req.body && req.body.action) || '');
  const payload = req.body || {};

  try {
    if (action === 'save-user') {
      const handle = normalizeHandle(payload.handle);
      const nextHandle = normalizeHandle(payload.nextHandle || payload.handle);
      const user = await get(`users/${handle}`);
      if (!user) {
        res.status(404).json({ error: 'That user could not be found.' });
        return;
      }

      const updatedUser = Object.assign({}, user, {
        handle: nextHandle,
        displayName: String(payload.displayName || user.displayName || nextHandle),
        bio: String(payload.bio || ''),
        accountType: String(payload.accountType || user.accountType || ''),
        walletBalance: Math.max(0, toNumber(payload.walletBalance, toNumber(user.walletBalance, 0))),
        banned: Boolean(payload.banned),
        banReason: payload.banned ? String(payload.banReason || '') : '',
        bannedAt: payload.banned ? (user.bannedAt || Date.now()) : null,
        createdAt: toNumber(user.createdAt, Date.now())
      });

      if (nextHandle !== handle) {
        await renameUserHandle(handle, nextHandle, updatedUser);
      } else {
        await patch(`users/${handle}`, updatedUser);
      }

      await syncDisplayNameEverywhere(nextHandle, updatedUser.displayName);
      res.status(200).json({ ok: true, handle: nextHandle });
      return;
    }

    if (action === 'set-wallet') {
      const handle = normalizeHandle(payload.handle);
      await patch(`users/${handle}`, { walletBalance: Math.max(0, toNumber(payload.walletBalance, 0)) });
      res.status(200).json({ ok: true });
      return;
    }

    if (action === 'adjust-wallet') {
      const handle = normalizeHandle(payload.handle);
      const user = await get(`users/${handle}`);
      if (!user) {
        res.status(404).json({ error: 'That user could not be found.' });
        return;
      }
      const nextBalance = Math.max(0, toNumber(user.walletBalance, 0) + toNumber(payload.delta, 0));
      await patch(`users/${handle}`, { walletBalance: nextBalance });
      res.status(200).json({ ok: true, walletBalance: nextBalance });
      return;
    }

    if (action === 'clear-profile-audio') {
      const handle = normalizeHandle(payload.handle);
      await clearProfileAudio(handle);
      res.status(200).json({ ok: true });
      return;
    }

    if (action === 'clear-profile-blocks') {
      const handle = normalizeHandle(payload.handle);
      await clearProfileBlocks(handle);
      res.status(200).json({ ok: true });
      return;
    }

    if (action === 'replace-profile-text') {
      const handle = normalizeHandle(payload.handle);
      const nextText = String(payload.text || '').trim();
      if (!nextText) {
        res.status(400).json({ error: 'Replacement text is required.' });
        return;
      }
      const changed = await replaceProfileText(handle, nextText);
      res.status(200).json({ ok: true, changed });
      return;
    }

    if (action === 'remove-post') {
      const postId = String(payload.postId || '');
      if (!postId) {
        res.status(400).json({ error: 'Post id is required.' });
        return;
      }
      await del(`communityData/posts/${postId}`).catch(() => null);
      await del(`communityPosts/${postId}`).catch(() => null);
      res.status(200).json({ ok: true });
      return;
    }

    if (action === 'delete-application') {
      const id = String(payload.id || '');
      if (!id) {
        res.status(400).json({ error: 'Application id is required.' });
        return;
      }
      await del(`adminData/applications/${id}`);
      res.status(200).json({ ok: true });
      return;
    }

    if (action === 'resolve-payout-request') {
      const id = String(payload.id || '');
      const status = String(payload.status || 'pending');
      if (!id) {
        res.status(400).json({ error: 'Payout request id is required.' });
        return;
      }
      await patch(`adminData/payoutRequests/${id}`, {
        status,
        reviewedAt: Date.now()
      });
      res.status(200).json({ ok: true });
      return;
    }

    if (action === 'delete-payout-request') {
      const id = String(payload.id || '');
      if (!id) {
        res.status(400).json({ error: 'Payout request id is required.' });
        return;
      }
      await del(`adminData/payoutRequests/${id}`);
      res.status(200).json({ ok: true });
      return;
    }

    res.status(400).json({ error: 'Unknown admin action.' });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Admin action failed.' });
  }
};
