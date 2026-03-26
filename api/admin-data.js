const { requireAdmin } = require('./_adminAuth');
const { get } = require('./_firebaseAdmin');

function toNumber(value, fallback = 0) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function sanitizeUser(handle, user, publicIndex) {
  const safeUser = Object.assign({}, user || {});
  delete safeUser.passwordHash;
  return {
    handle: String((safeUser && safeUser.handle) || handle || '').toLowerCase(),
    displayName: String((safeUser && safeUser.displayName) || handle || 'Member'),
    email: String((safeUser && safeUser.email) || ''),
    accountType: String((safeUser && safeUser.accountType) || ''),
    bio: String((safeUser && safeUser.bio) || ''),
    interests: String((safeUser && safeUser.interests) || ''),
    banned: Boolean(safeUser && safeUser.banned),
    banReason: String((safeUser && safeUser.banReason) || ''),
    walletBalance: toNumber(safeUser && safeUser.walletBalance, 0),
    recognitionPoints: toNumber(safeUser && safeUser.recognitionPoints, 0),
    beVividPlus: Boolean(safeUser && (safeUser['bevivid+'] === true || safeUser.bevividPlus === true)),
    profileImage: String((publicIndex && publicIndex.profileImage) || ''),
    profileSongReady: Boolean(safeUser && safeUser.profileSongReady),
    profileUpdatedAt: toNumber(safeUser && safeUser.profileUpdatedAt, 0),
    createdAt: toNumber(safeUser && safeUser.createdAt, 0)
  };
}

function sanitizePost(post) {
  const stats = post && post.stats ? post.stats : {};
  return {
    id: String((post && post.id) || ''),
    authorHandle: String((post && post.authorHandle) || ''),
    authorDisplayName: String((post && post.authorDisplayName) || ''),
    text: String((post && post.text) || ''),
    imageUrl: String((post && post.imageUrl) || ''),
    createdAt: toNumber(post && post.createdAt, 0),
    likeCount: toNumber(stats.likeCount, toNumber(post && post.likeCount, 0)),
    commentCount: toNumber(stats.commentCount, toNumber(post && post.commentCount, 0)),
    impressionCount: toNumber(stats.impressionCount, toNumber(post && post.impressionCount, 0)),
    reachCount: toNumber(stats.reachCount, toNumber(post && post.reachCount, 0))
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
    status: String((application && application.status) || 'submitted'),
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

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed.' });
    return;
  }

  if (!requireAdmin(req, res)) return;

  try {
    const [usersMap, publicIndexMap, primaryPosts, legacyPosts, applicationsMap, payoutRequestsMap] = await Promise.all([
      get('users').catch(() => ({})),
      get('publicUserIndex').catch(() => ({})),
      get('communityData/posts').catch(() => ({})),
      get('communityPosts').catch(() => ({})),
      get('adminData/applications').catch(() => ({})),
      get('adminData/payoutRequests').catch(() => ({}))
    ]);

    const users = Object.entries(usersMap || {})
      .map(([handle, user]) => sanitizeUser(handle, user, publicIndexMap && publicIndexMap[handle]))
      .sort((a, b) => a.handle.localeCompare(b.handle));

    const postsSource = primaryPosts && Object.keys(primaryPosts).length ? primaryPosts : (legacyPosts || {});
    const posts = Object.values(postsSource || {})
      .filter(Boolean)
      .map(sanitizePost)
      .sort((a, b) => b.createdAt - a.createdAt);

    const applications = Object.entries(applicationsMap || {})
      .map(([id, application]) => sanitizeApplication(id, application))
      .sort((a, b) => b.createdAt - a.createdAt);

    const payoutRequests = Object.entries(payoutRequestsMap || {})
      .map(([id, payout]) => sanitizePayout(id, payout))
      .sort((a, b) => b.createdAt - a.createdAt);

    res.status(200).json({
      users,
      posts,
      applications,
      payoutRequests
    });
  } catch (error) {
    res.status(500).json({ error: 'Admin data could not be loaded right now.' });
  }
};
