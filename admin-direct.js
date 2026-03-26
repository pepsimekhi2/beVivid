const FIREBASE_DB_URL = 'https://bevivid-73a69-default-rtdb.firebaseio.com';
const OWNER_PASSWORD_HASH = '2d2370db2447ff8cf4f3accd68c85aa119a9c893effd200a9b69176e9fc5eb98';
const OWNER_SESSION_KEY = 'bevivid_owner_unlocked';
const COMMUNITY_ROOT = 'communityData';

const state = {
  authenticated: false,
  data: {
    users: [],
    posts: [],
    applications: [],
    payoutRequests: []
  },
  selectedHandle: '',
  userSearch: '',
  postSearch: ''
};

const esc = value => String(value || '').replace(/[&<>"]/g, char => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;'
}[char]));

const attr = value => esc(value).replace(/'/g, '&#39;');
const money = value => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(value || 0));
const num = value => new Intl.NumberFormat('en-US').format(Number(value || 0));

function ago(value) {
  const stamp = Number(value || 0);
  if (!stamp) return 'Unknown time';
  const diff = Math.max(1, Date.now() - stamp);
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(stamp).toLocaleDateString();
}

function setStatus(message, tone = '') {
  const node = document.getElementById('adminStatus');
  node.textContent = message;
  node.className = `status${tone ? ` ${tone}` : ''}`;
}

function toNumber(value, fallback = 0) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function normalizeHandle(value) {
  return String(value || '').replace(/[^a-z0-9_]/gi, '').toLowerCase();
}

function firebaseUrl(path) {
  return `${FIREBASE_DB_URL}/${path}.json`;
}

async function firebaseRequest(path, options = {}) {
  const response = await fetch(firebaseUrl(path), {
    method: options.method || 'GET',
    headers: options.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });

  let data = null;
  try {
    data = await response.json();
  } catch (_) {
    data = null;
  }

  if (!response.ok) {
    throw new Error(data && data.error ? data.error : `Firebase request failed (${response.status}).`);
  }
  return data;
}

function getNode(path) {
  return firebaseRequest(path, { method: 'GET' });
}

function putNode(path, body) {
  return firebaseRequest(path, { method: 'PUT', body });
}

function patchNode(path, body) {
  return firebaseRequest(path, { method: 'PATCH', body });
}

function deleteNode(path) {
  return firebaseRequest(path, { method: 'DELETE' });
}

async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(String(value || ''));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function bytesToBase64(bytes) {
  let binary = '';
  bytes.forEach(byte => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function base64ToBytes(base64) {
  const binary = atob(String(base64 || ''));
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

function encodeLayout(layout) {
  return bytesToBase64(new TextEncoder().encode(JSON.stringify(layout || {})));
}

function decodeLayout(value) {
  return JSON.parse(new TextDecoder().decode(base64ToBytes(value)));
}

function sanitizeUser(handle, user, publicIndex) {
  const safeUser = Object.assign({}, user || {});
  delete safeUser.passwordHash;
  return {
    handle: String(safeUser.handle || handle || '').toLowerCase(),
    displayName: String(safeUser.displayName || handle || 'Member'),
    email: String(safeUser.email || ''),
    accountType: String(safeUser.accountType || ''),
    bio: String(safeUser.bio || ''),
    banned: Boolean(safeUser.banned),
    banReason: String(safeUser.banReason || ''),
    walletBalance: toNumber(safeUser.walletBalance, 0),
    beVividPlus: Boolean(safeUser['bevivid+'] === true || safeUser.bevividPlus === true),
    profileImage: String((publicIndex && publicIndex.profileImage) || ''),
    profileSongReady: Boolean(safeUser.profileSongReady || safeUser.profileSongAudio),
    createdAt: toNumber(safeUser.createdAt, 0)
  };
}

function sanitizePost(post) {
  const stats = post && post.stats ? post.stats : {};
  return {
    id: String((post && post.id) || ''),
    authorHandle: String((post && post.authorHandle) || ''),
    authorDisplayName: String((post && post.authorDisplayName) || ''),
    text: String((post && post.text) || ''),
    createdAt: toNumber(post && post.createdAt, 0),
    likeCount: toNumber(stats.likeCount, toNumber(post && post.likeCount, 0)),
    commentCount: toNumber(stats.commentCount, toNumber(post && post.commentCount, 0)),
    impressionCount: toNumber(stats.impressionCount, toNumber(post && post.impressionCount, 0))
  };
}

function sanitizeApplication(id, application) {
  return {
    id,
    type: String((application && application.type) || ''),
    firstName: String((application && application.firstName) || ''),
    lastName: String((application && application.lastName) || ''),
    email: String((application && application.email) || ''),
    phone: String((application && application.phone) || ''),
    why: String((application && application.why) || ''),
    createdAt: toNumber(application && application.createdAt, 0)
  };
}

function sanitizePayout(id, payout) {
  return {
    id,
    requesterHandle: String((payout && payout.requesterHandle) || ''),
    requesterDisplayName: String((payout && payout.requesterDisplayName) || ''),
    requesterEmail: String((payout && payout.requesterEmail) || ''),
    amount: toNumber(payout && payout.amount, 0),
    note: String((payout && payout.note) || ''),
    status: String((payout && payout.status) || 'pending'),
    createdAt: toNumber(payout && payout.createdAt, 0)
  };
}

function selectedUser() {
  return state.data.users.find(user => user.handle === state.selectedHandle) || null;
}

function filteredUsers() {
  const query = state.userSearch.trim().toLowerCase();
  if (!query) return state.data.users;
  return state.data.users.filter(user => [user.handle, user.displayName, user.email].join(' ').toLowerCase().includes(query));
}

function pickBestUserMatch(users, query) {
  const normalized = String(query || '').trim().toLowerCase().replace(/^@+/, '');
  if (!normalized) return users[0] || null;
  return users.find(user => String(user.handle || '').toLowerCase() === normalized) ||
    users.find(user => String(user.handle || '').toLowerCase().startsWith(normalized)) ||
    users.find(user => String(user.displayName || '').toLowerCase().startsWith(normalized)) ||
    users[0] ||
    null;
}

function filteredPosts() {
  const query = state.postSearch.trim().toLowerCase();
  if (!query) return state.data.posts;
  return state.data.posts.filter(post => [post.authorHandle, post.authorDisplayName, post.text].join(' ').toLowerCase().includes(query));
}

function renderStats() {
  const users = state.data.users;
  const banned = users.filter(user => user.banned).length;
  const pending = state.data.payoutRequests.filter(item => item.status === 'pending').length;
  document.getElementById('statsGrid').innerHTML = `
    <div class="card"><small>Total Users</small><strong>${num(users.length)}</strong><span>Accounts in Firebase right now.</span></div>
    <div class="card"><small>Banned Users</small><strong>${num(banned)}</strong><span>Accounts currently blocked.</span></div>
    <div class="card"><small>Community Posts</small><strong>${num(state.data.posts.length)}</strong><span>Posts available in the active feed.</span></div>
    <div class="card"><small>Applications</small><strong>${num(state.data.applications.length)}</strong><span>Partner and business submissions waiting for review.</span></div>
    <div class="card"><small>Pending Payouts</small><strong>${num(pending)}</strong><span>Creator payout requests still waiting on you.</span></div>
  `;
}

function renderUsers() {
  const list = document.getElementById('userList');
  const users = filteredUsers();
  if (!users.length) {
    list.innerHTML = '<div class="empty">No users match that search yet.</div>';
    return;
  }
  list.innerHTML = users.map(user => `
    <button class="user-row ${state.selectedHandle === user.handle ? 'active' : ''}" type="button" onclick="selectUser('${attr(user.handle)}')">
      <div class="avatar">${user.profileImage ? `<img src="${attr(user.profileImage)}" alt="">` : esc((user.displayName || user.handle || '?').charAt(0).toUpperCase())}</div>
      <div class="user-meta">
        <div class="user-name">${esc(user.displayName || 'Member')}</div>
        <div class="tiny">@${esc(user.handle)}</div>
        <div class="chips">
          ${user.accountType ? `<span class="chip ${attr(String(user.accountType).toLowerCase())}">${esc(user.accountType)}</span>` : ''}
          ${user.beVividPlus ? '<span class="chip plus">beVivid+</span>' : ''}
          ${user.banned ? '<span class="chip banned">Banned</span>' : ''}
        </div>
      </div>
    </button>
  `).join('');
}

function renderUserEditor() {
  const box = document.getElementById('userEditor');
  const user = selectedUser();
  if (!user) {
    box.innerHTML = '<div class="empty">Pick a user on the left to edit their profile, handle, bio, wallet, ban status, audio, and vivid page blocks.</div>';
    return;
  }

  box.innerHTML = `
    <div class="panel">
      <div class="row">
        <div>
          <div class="eyebrow">Selected User</div>
          <h2 class="section-title">${esc(user.displayName || user.handle)}</h2>
          <div class="copy">@${esc(user.handle)}${user.email ? ` | ${esc(user.email)}` : ''}</div>
        </div>
        <div class="chips">
          ${user.profileSongReady ? '<span class="chip">Audio Ready</span>' : '<span class="chip">No Audio</span>'}
          ${user.beVividPlus ? '<span class="chip plus">beVivid+</span>' : ''}
        </div>
      </div>
      <div class="editor">
        <label class="field"><span class="label">Display Name</span><input class="input" id="editorDisplayName" type="text" value="${attr(user.displayName || '')}"></label>
        <label class="field"><span class="label">Handle</span><input class="input" id="editorHandle" type="text" value="${attr(user.handle || '')}"></label>
        <label class="field"><span class="label">Account Type</span>
          <select class="select" id="editorAccountType">
            ${['', 'creator', 'student', 'partner', 'business'].map(option => `<option value="${option}" ${String(user.accountType || '').toLowerCase() === option ? 'selected' : ''}>${option ? option.charAt(0).toUpperCase() + option.slice(1) : 'Member'}</option>`).join('')}
          </select>
        </label>
        <label class="field"><span class="label">Wallet Balance</span><input class="input" id="editorWallet" type="number" min="0" step="0.01" value="${attr(String(Number(user.walletBalance || 0).toFixed(2)))}"></label>
        <label class="field wide"><span class="label">Bio</span><textarea class="textarea" id="editorBio">${esc(user.bio || '')}</textarea></label>
        <label class="field wide"><span class="label">Force Replace Vivid Page Text Blocks</span><textarea class="textarea" id="editorReplaceText" placeholder="Optional. Every text block on the user's vivid page will be replaced with this content."></textarea></label>
        <div class="field wide"><span class="label">Ban Status</span><label class="copy"><input type="checkbox" id="editorBanned" ${user.banned ? 'checked' : ''}> Ban this user</label></div>
        <label class="field wide"><span class="label">Ban Reason</span><textarea class="textarea" id="editorBanReason">${esc(user.banReason || '')}</textarea></label>
      </div>
      <div class="action-board">
        <div class="action-slab">
          <div><div class="eyebrow">Identity</div><h3 class="mini-title">Save profile fields.</h3></div>
          <div class="action-copy">Apply display name, handle, bio, account type, and ban changes in one pass.</div>
          <div class="action-row"><button class="btn" type="button" onclick="saveUser()">Save User Changes</button></div>
        </div>
        <div class="action-slab">
          <div><div class="eyebrow">Wallet</div><h3 class="mini-title">Adjust creator balance.</h3></div>
          <div class="action-copy">Set an exact amount or nudge the wallet up and down in quick owner increments.</div>
          <div class="action-row">
            <button class="ghost" type="button" onclick="setWallet()">Set Wallet</button>
            <button class="ghost" type="button" onclick="adjustWallet(-1)">- $1.00</button>
            <button class="ghost" type="button" onclick="adjustWallet(1)">+ $1.00</button>
          </div>
        </div>
        <div class="action-slab">
          <div><div class="eyebrow">Vivid Page</div><h3 class="mini-title">Clean up profile media.</h3></div>
          <div class="action-copy">Force page text changes, remove uploaded audio, or wipe custom blocks if you need to intervene.</div>
          <div class="action-row">
            <button class="ghost" type="button" onclick="replacePageText()">Replace Page Text</button>
            <button class="ghost" type="button" onclick="clearAudio()">Remove Audio</button>
            <button class="danger" type="button" onclick="clearBlocks()">Remove Blocks</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderPosts() {
  const list = document.getElementById('postList');
  const posts = filteredPosts();
  if (!posts.length) {
    list.innerHTML = '<div class="empty">No posts match that search yet.</div>';
    return;
  }
  list.innerHTML = posts.map(post => `
    <article class="entry">
      <div class="row">
        <div>
          <div class="eyebrow">Community Post</div>
          <h3 class="section-title">${esc(post.authorDisplayName || post.authorHandle || 'Member')}</h3>
          <div class="tiny">@${esc(post.authorHandle || '')} | ${esc(ago(post.createdAt))}</div>
        </div>
        <div class="chips">
          <span class="chip">${num(post.impressionCount)} impressions</span>
          <span class="chip">${num(post.likeCount)} likes</span>
          <span class="chip">${num(post.commentCount)} comments</span>
          <button class="danger" type="button" onclick="removePost('${attr(post.id)}')">Delete Post</button>
        </div>
      </div>
      <div class="copy">${esc(post.text || 'Untitled post')}</div>
    </article>
  `).join('');
}

function renderApplications() {
  const list = document.getElementById('applicationList');
  const items = state.data.applications;
  if (!items.length) {
    list.innerHTML = '<div class="empty">No partner or business applications have been captured yet.</div>';
    return;
  }
  list.innerHTML = items.map(item => `
    <article class="entry">
      <div class="row">
        <div>
          <div class="eyebrow">${esc(item.type || 'Application')}</div>
          <h3 class="section-title">${esc(`${item.firstName || ''} ${item.lastName || ''}`.trim() || item.email || 'Submission')}</h3>
          <div class="tiny">${esc(item.email || 'No email')}${item.phone ? ` | ${esc(item.phone)}` : ''} | ${esc(ago(item.createdAt))}</div>
        </div>
        <button class="danger" type="button" onclick="deleteApplication('${attr(item.id)}')">Remove</button>
      </div>
      <div class="copy">${esc(item.why || 'No message saved.')}</div>
    </article>
  `).join('');
}

function renderPayouts() {
  const list = document.getElementById('payoutList');
  const items = state.data.payoutRequests;
  if (!items.length) {
    list.innerHTML = '<div class="empty">No payout requests have been submitted yet.</div>';
    return;
  }
  list.innerHTML = items.map(item => `
    <article class="entry">
      <div class="row">
        <div>
          <div class="eyebrow">Payout Request</div>
          <h3 class="section-title">${esc(item.requesterDisplayName || item.requesterHandle || 'Creator')}</h3>
          <div class="tiny">@${esc(item.requesterHandle || '')}${item.requesterEmail ? ` | ${esc(item.requesterEmail)}` : ''} | ${esc(ago(item.createdAt))}</div>
        </div>
        <div class="chips">
          <span class="chip">${money(item.amount)}</span>
          <span class="chip">${esc(item.status || 'pending')}</span>
        </div>
      </div>
      <div class="copy">${esc(item.note || 'No payout note was included.')}</div>
      <div class="actions">
        <button class="btn" type="button" onclick="resolvePayout('${attr(item.id)}','paid')">Mark Paid</button>
        <button class="ghost" type="button" onclick="resolvePayout('${attr(item.id)}','declined')">Decline</button>
        <button class="danger" type="button" onclick="deletePayout('${attr(item.id)}')">Remove</button>
      </div>
    </article>
  `).join('');
}

function renderAll() {
  renderStats();
  renderUsers();
  renderUserEditor();
  renderPosts();
  renderApplications();
  renderPayouts();
}

function renderLoading() {
  const skeleton = '<div class="entry"><div class="copy">Loading...</div></div>';
  document.getElementById('userList').innerHTML = skeleton + skeleton;
  document.getElementById('userEditor').innerHTML = skeleton;
  document.getElementById('postList').innerHTML = skeleton + skeleton;
  document.getElementById('applicationList').innerHTML = skeleton;
  document.getElementById('payoutList').innerHTML = skeleton;
}

function selectUser(handle) {
  state.selectedHandle = handle;
  renderUsers();
  renderUserEditor();
}

function searchUsers() {
  state.userSearch = document.getElementById('userSearch').value || '';
  const users = filteredUsers();
  const best = pickBestUserMatch(users, state.userSearch);
  if (best) state.selectedHandle = best.handle;
  renderUsers();
  renderUserEditor();
  setStatus(users.length ? `Found ${users.length} matching user${users.length === 1 ? '' : 's'}.` : 'No users matched that search.');
}

function clearUserSearch() {
  state.userSearch = '';
  document.getElementById('userSearch').value = '';
  if (!state.selectedHandle && state.data.users[0]) state.selectedHandle = state.data.users[0].handle;
  renderUsers();
  renderUserEditor();
  setStatus('User search cleared.', 'ok');
}

function searchPosts() {
  state.postSearch = document.getElementById('postSearch').value || '';
  renderPosts();
  setStatus(filteredPosts().length ? 'Post search updated.' : 'No posts matched that search.');
}

function clearPostSearch() {
  state.postSearch = '';
  document.getElementById('postSearch').value = '';
  renderPosts();
  setStatus('Post search cleared.', 'ok');
}

async function verifyPassword(password) {
  return sha256Hex(password).then(hash => hash === OWNER_PASSWORD_HASH);
}

function setAuthenticated(next) {
  state.authenticated = Boolean(next);
  document.getElementById('loginOverlay').classList.toggle('open', !state.authenticated);
  if (state.authenticated) {
    sessionStorage.setItem(OWNER_SESSION_KEY, '1');
  } else {
    sessionStorage.removeItem(OWNER_SESSION_KEY);
  }
}

async function ensureAuth() {
  setAuthenticated(sessionStorage.getItem(OWNER_SESSION_KEY) === '1');
}

async function loginAdmin(event) {
  event.preventDefault();
  const button = document.getElementById('loginBtn');
  const status = document.getElementById('loginStatus');
  button.disabled = true;
  button.textContent = 'Unlocking...';
  status.textContent = '';

  try {
    const accepted = await verifyPassword(document.getElementById('adminPassword').value);
    if (!accepted) throw new Error('That password was not accepted.');
    document.getElementById('adminPassword').value = '';
    setAuthenticated(true);
    await loadDashboard();
  } catch (error) {
    status.textContent = error.message || 'That password was not accepted.';
    status.className = 'status err';
  } finally {
    button.disabled = false;
    button.textContent = 'Unlock Dashboard';
  }
}

function logoutAdmin() {
  setAuthenticated(false);
  setStatus('Dashboard locked.');
}

async function moveNodeIfPresent(fromPath, toPath, mutate) {
  const current = await getNode(fromPath).catch(() => null);
  if (current === null || current === undefined) return;
  const nextValue = typeof mutate === 'function' ? mutate(current) : current;
  await putNode(toPath, nextValue);
  await deleteNode(fromPath).catch(() => null);
}

async function updatePostsForHandle(rootPath, oldHandle, newHandle, displayName) {
  const posts = await getNode(rootPath).catch(() => null);
  if (!posts || typeof posts !== 'object') return;

  for (const [postId, postValue] of Object.entries(posts)) {
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
      await putNode(`${rootPath}/${postId}`, post);
    }
  }
}

async function renameSocialReferences(oldHandle, newHandle) {
  const social = await getNode(`${COMMUNITY_ROOT}/social`).catch(() => null);
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

  await putNode(`${COMMUNITY_ROOT}/social`, updated);
}

async function renameNotificationBucket(oldHandle, newHandle) {
  if (oldHandle === newHandle) return;
  const notifications = await getNode(`${COMMUNITY_ROOT}/notifications/${oldHandle}`).catch(() => null);
  if (!notifications) return;
  await putNode(`${COMMUNITY_ROOT}/notifications/${newHandle}`, notifications);
  await deleteNode(`${COMMUNITY_ROOT}/notifications/${oldHandle}`).catch(() => null);
}

async function renamePayoutRequests(oldHandle, newHandle, displayName, email) {
  const requests = await getNode('adminData/payoutRequests').catch(() => null);
  if (!requests || typeof requests !== 'object') return;
  for (const [id, request] of Object.entries(requests)) {
    if (!request || request.requesterHandle !== oldHandle) continue;
    await patchNode(`adminData/payoutRequests/${id}`, {
      requesterHandle: newHandle,
      requesterDisplayName: displayName || request.requesterDisplayName || newHandle,
      requesterEmail: email || request.requesterEmail || ''
    });
  }
}

async function renameUserHandle(oldHandle, newHandle, userRecord) {
  if (oldHandle === newHandle) return;

  const existingTarget = await getNode(`users/${newHandle}`).catch(() => null);
  if (existingTarget) throw new Error('That replacement handle already exists.');

  await putNode(`users/${newHandle}`, Object.assign({}, userRecord, { handle: newHandle }));
  await deleteNode(`users/${oldHandle}`).catch(() => null);

  await moveNodeIfPresent(`publicUserIndex/${oldHandle}`, `publicUserIndex/${newHandle}`, current => Object.assign({}, current, {
    handle: newHandle,
    displayName: userRecord.displayName || current.displayName || newHandle,
    updatedAt: Date.now()
  }));
  await moveNodeIfPresent(`profileAudio/${oldHandle}`, `profileAudio/${newHandle}`);
  await renameSocialReferences(oldHandle, newHandle);
  await renameNotificationBucket(oldHandle, newHandle);
  await renamePayoutRequests(oldHandle, newHandle, userRecord.displayName, userRecord.email);
  await updatePostsForHandle(`${COMMUNITY_ROOT}/posts`, oldHandle, newHandle, userRecord.displayName);
  await updatePostsForHandle('communityPosts', oldHandle, newHandle, userRecord.displayName);
}

async function syncDisplayNameEverywhere(handle, displayName) {
  await patchNode(`publicUserIndex/${handle}`, {
    handle,
    displayName,
    updatedAt: Date.now()
  }).catch(() => null);
  await updatePostsForHandle(`${COMMUNITY_ROOT}/posts`, handle, handle, displayName);
  await updatePostsForHandle('communityPosts', handle, handle, displayName);
}

async function clearProfileAudioDirect(handle) {
  await deleteNode(`profileAudio/${handle}`).catch(() => null);
  await patchNode(`users/${handle}`, {
    profileSongReady: false,
    profileSongLabel: '',
    profileSongAudio: null,
    profileUpdatedAt: Date.now()
  });
}

async function clearProfileBlocksDirect(handle) {
  const user = await getNode(`users/${handle}`).catch(() => null);
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

  await patchNode(`users/${handle}`, {
    profileLayoutEncoded: encodedLayout,
    profileUpdatedAt: Date.now()
  });

  await patchNode(`publicUserIndex/${handle}`, {
    profileImage: '',
    updatedAt: Date.now()
  }).catch(() => null);
}

async function replaceProfileTextDirect(handle, nextText) {
  const user = await getNode(`users/${handle}`).catch(() => null);
  if (!user || !user.profileLayoutEncoded) throw new Error('This user does not have a saved vivid page yet.');

  const layout = decodeLayout(user.profileLayoutEncoded);
  let changed = 0;
  layout.elements = (layout.elements || []).map(element => {
    if (!element || element.type !== 'text') return element;
    changed += 1;
    return Object.assign({}, element, { text: nextText });
  });

  if (!changed) throw new Error('There are no text blocks to replace on this vivid page.');

  await patchNode(`users/${handle}`, {
    profileLayoutEncoded: encodeLayout(layout),
    profileUpdatedAt: Date.now()
  });
}

async function loadDashboard() {
  if (!state.authenticated) return;
  renderLoading();
  setStatus('Loading the owner dashboard...');

  try {
    const [usersMap, publicIndexMap, primaryPosts, legacyPosts, applicationsMap, payoutRequestsMap] = await Promise.all([
      getNode('users').catch(() => ({})),
      getNode('publicUserIndex').catch(() => ({})),
      getNode(`${COMMUNITY_ROOT}/posts`).catch(() => ({})),
      getNode('communityPosts').catch(() => ({})),
      getNode('adminData/applications').catch(() => ({})),
      getNode('adminData/payoutRequests').catch(() => ({}))
    ]);

    state.data.users = Object.entries(usersMap || {})
      .map(([handle, user]) => sanitizeUser(handle, user, publicIndexMap && publicIndexMap[handle]))
      .sort((a, b) => a.handle.localeCompare(b.handle));

    const postsSource = primaryPosts && Object.keys(primaryPosts).length ? primaryPosts : (legacyPosts || {});
    state.data.posts = Object.values(postsSource || {})
      .filter(Boolean)
      .map(sanitizePost)
      .sort((a, b) => b.createdAt - a.createdAt);

    state.data.applications = Object.entries(applicationsMap || {})
      .map(([id, application]) => sanitizeApplication(id, application))
      .sort((a, b) => b.createdAt - a.createdAt);

    state.data.payoutRequests = Object.entries(payoutRequestsMap || {})
      .map(([id, payout]) => sanitizePayout(id, payout))
      .sort((a, b) => b.createdAt - a.createdAt);

    const handles = state.data.users.map(user => user.handle);
    if (!handles.includes(state.selectedHandle)) state.selectedHandle = handles[0] || '';
    renderAll();
    setStatus('Owner tools are live.', 'ok');
  } catch (error) {
    setStatus(`${error.message || 'Admin data could not be loaded right now.'} Firebase rules need read/write access for the dashboard paths.`, 'err');
  }
}

async function runAction(executor, message) {
  try {
    await executor();
    setStatus(message, 'ok');
    await loadDashboard();
  } catch (error) {
    setStatus(error.message || 'Owner action failed.', 'err');
  }
}

async function saveUser() {
  const user = selectedUser();
  if (!user) return;
  const originalHandle = user.handle;
  const normalizedHandle = normalizeHandle(document.getElementById('editorHandle').value || '') || user.handle;
  state.selectedHandle = normalizedHandle;

  await runAction(async () => {
    const current = await getNode(`users/${originalHandle}`).catch(() => null);
    if (!current) throw new Error('That user could not be found.');

    const banned = Boolean(document.getElementById('editorBanned').checked);
    const updatedUser = Object.assign({}, current, {
      handle: normalizedHandle,
      displayName: String(document.getElementById('editorDisplayName').value || current.displayName || normalizedHandle),
      bio: String(document.getElementById('editorBio').value || ''),
      accountType: String(document.getElementById('editorAccountType').value || current.accountType || ''),
      walletBalance: Math.max(0, toNumber(document.getElementById('editorWallet').value, toNumber(current.walletBalance, 0))),
      banned,
      banReason: banned ? String(document.getElementById('editorBanReason').value || '') : '',
      bannedAt: banned ? (current.bannedAt || Date.now()) : null,
      createdAt: toNumber(current.createdAt, Date.now())
    });

    if (normalizedHandle !== originalHandle) {
      await renameUserHandle(originalHandle, normalizedHandle, updatedUser);
    } else {
      await patchNode(`users/${originalHandle}`, updatedUser);
    }

    await syncDisplayNameEverywhere(normalizedHandle, updatedUser.displayName);
  }, 'User changes saved.');
}

async function setWallet() {
  const user = selectedUser();
  if (!user) return;
  await runAction(async () => {
    await patchNode(`users/${user.handle}`, {
      walletBalance: Math.max(0, toNumber(document.getElementById('editorWallet').value, 0))
    });
  }, 'Wallet balance updated.');
}

async function adjustWallet(delta) {
  const user = selectedUser();
  if (!user) return;
  await runAction(async () => {
    const current = await getNode(`users/${user.handle}`).catch(() => null);
    if (!current) throw new Error('That user could not be found.');
    const nextBalance = Math.max(0, toNumber(current.walletBalance, 0) + toNumber(delta, 0));
    await patchNode(`users/${user.handle}`, { walletBalance: nextBalance });
  }, 'Wallet balance adjusted.');
}

async function clearAudio() {
  const user = selectedUser();
  if (!user) return;
  await runAction(async () => {
    await clearProfileAudioDirect(user.handle);
  }, 'Profile audio removed.');
}

async function clearBlocks() {
  const user = selectedUser();
  if (!user) return;
  if (!window.confirm('Remove every custom vivid page block for this user?')) return;
  await runAction(async () => {
    await clearProfileBlocksDirect(user.handle);
  }, 'Custom vivid page blocks removed.');
}

async function replacePageText() {
  const user = selectedUser();
  if (!user) return;
  const text = document.getElementById('editorReplaceText').value.trim();
  if (!text) {
    setStatus('Enter replacement text first.', 'err');
    return;
  }
  await runAction(async () => {
    await replaceProfileTextDirect(user.handle, text);
  }, 'Profile text blocks replaced.');
}

async function removePost(postId) {
  if (!window.confirm('Delete this community post?')) return;
  await runAction(async () => {
    await deleteNode(`${COMMUNITY_ROOT}/posts/${postId}`).catch(() => null);
    await deleteNode(`communityPosts/${postId}`).catch(() => null);
  }, 'Community post removed.');
}

async function deleteApplication(id) {
  await runAction(async () => {
    await deleteNode(`adminData/applications/${id}`);
  }, 'Application removed from the inbox.');
}

async function resolvePayout(id, status) {
  await runAction(async () => {
    await patchNode(`adminData/payoutRequests/${id}`, {
      status,
      reviewedAt: Date.now()
    });
  }, `Payout request marked ${status}.`);
}

async function deletePayout(id) {
  await runAction(async () => {
    await deleteNode(`adminData/payoutRequests/${id}`);
  }, 'Payout request removed.');
}

document.getElementById('loginForm').addEventListener('submit', loginAdmin);
document.getElementById('userSearch').addEventListener('input', event => {
  state.userSearch = event.target.value || '';
  const users = filteredUsers();
  const best = pickBestUserMatch(users, state.userSearch);
  if (best) state.selectedHandle = best.handle;
  renderUsers();
  renderUserEditor();
});
document.getElementById('postSearch').addEventListener('input', event => {
  state.postSearch = event.target.value || '';
  renderPosts();
});

(async function init() {
  await ensureAuth();
  if (state.authenticated) {
    await loadDashboard();
  } else {
    setStatus('Enter the owner password to unlock direct Firebase tools.');
  }
})();
