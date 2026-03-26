const { get, put } = require('./_firebaseAdmin');

const COMMUNITY_ROOT = 'communityData';
const IMPRESSION_RATE = 0.01 / 100;
const LIKE_RATE = 0.0025;
const COMMENT_RATE = 0.005;

function normalizeHandle(value) {
  return String(value || '').replace(/[^a-z0-9_]/gi, '').toLowerCase();
}

function makeId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizePost(post) {
  if (!post) return null;
  return Object.assign({
    stats: {
      likeCount: Number(post.likeCount || 0),
      commentCount: Number(post.commentCount || 0),
      impressionCount: Number(post.impressionCount || 0),
      reachCount: Number(post.reachCount || 0)
    },
    comments: post.comments || {},
    likes: post.likes || {}
  }, post);
}

function getExternalLikeCount(post) {
  return Object.keys(post.likes || {}).filter(handle => handle && handle !== post.authorHandle).length;
}

function getExternalCommentCount(post) {
  return Object.values(post.comments || {}).filter(comment => comment && comment.authorHandle && comment.authorHandle !== post.authorHandle).length;
}

function getComputedWallet(posts) {
  return posts.reduce((sum, post) => {
    const impressions = Number(post.stats?.impressionCount || 0);
    const externalLikes = getExternalLikeCount(post);
    const externalComments = getExternalCommentCount(post);
    return sum + (impressions * IMPRESSION_RATE) + (externalLikes * LIKE_RATE) + (externalComments * COMMENT_RATE);
  }, 0);
}

function hasWalletOverride(user) {
  return Boolean(user && user.walletBalance !== undefined && user.walletBalance !== null && user.walletBalance !== '');
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed.' });
    return;
  }

  try {
    const handle = normalizeHandle(req.body && req.body.handle);
    const note = String((req.body && req.body.note) || '').trim();

    if (!handle) {
      res.status(400).json({ error: 'Handle is required.' });
      return;
    }

    const user = await get(`users/${handle}`).catch(() => null);
    if (!user || String((user.accountType || '')).toLowerCase() !== 'creator') {
      res.status(403).json({ error: 'Only creator accounts can request payouts.' });
      return;
    }

    if (user.banned) {
      res.status(403).json({ error: 'This creator account cannot request payouts right now.' });
      return;
    }

    const [primaryPosts, legacyPosts, payoutRequests] = await Promise.all([
      get(`${COMMUNITY_ROOT}/posts`).catch(() => ({})),
      get('communityPosts').catch(() => ({})),
      get('adminData/payoutRequests').catch(() => ({}))
    ]);

    const existingPending = Object.values(payoutRequests || {}).some(request => request && request.requesterHandle === handle && request.status === 'pending');
    if (existingPending) {
      res.status(409).json({ error: 'There is already a pending payout request for this creator.' });
      return;
    }

    const postsSource = primaryPosts && Object.keys(primaryPosts).length ? primaryPosts : (legacyPosts || {});
    const posts = Object.values(postsSource || {})
      .map(normalizePost)
      .filter(post => post && post.authorHandle === handle);
    const computedWallet = getComputedWallet(posts);
    const manualWallet = Number(user.walletBalance);
    const amount = hasWalletOverride(user) && Number.isFinite(manualWallet)
      ? Math.max(0, manualWallet)
      : computedWallet;

    if (!amount || amount <= 0) {
      res.status(400).json({ error: 'There is no payout balance available to request yet.' });
      return;
    }

    const id = makeId('payout');
    await put(`adminData/payoutRequests/${id}`, {
      id,
      requesterHandle: handle,
      requesterDisplayName: user.displayName || handle,
      requesterEmail: user.email || '',
      amount: Number(amount.toFixed(2)),
      note,
      status: 'pending',
      createdAt: Date.now()
    });

    res.status(200).json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: 'Payout request could not be submitted right now.' });
  }
};
