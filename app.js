/* ─── State ─────────────────────────────────────────────────────── */
const state = {
  manifest: null,
  navPath: [], // array of node objects representing the navigation path
  testMeta: null, // { id, label, path }
  exam: null, // loaded JSON { topic, questions }
  answers: [], // [{ selected: [...keys], submitted: bool }]
  current: 0,
  feedbackOpen: [], // [bool]
  user: null, // Firebase user object (null = not authenticated)
  authMode: "signin", // 'signin' or 'signup'
  _historyCache: null, // cached history records (refreshed on load + after saveHistory)
  _breadcrumbExpanded: false, // whether a collapsed breadcrumb is expanded
  _breadcrumbSig: null, // signature of the current crumb trail (reset detector)
  _lastCrumbs: null, // last crumbs passed to setBreadcrumb (for in-place expand)
};

/* ─── Session Persistence (localStorage + Firestore) ──────────── */
function sessionKey() {
  if (state.navPath.length === 0 || !state.testMeta) return null;
  const pathIds = state.navPath.map((n) => n.id).join("_");
  return `cert_session_${pathIds}_${state.testMeta.id}`;
}

/* ─── Cert / mode context helpers ─────────────────────────────── */
// The certification is the node at navPath depth 1 (provider is depth 0).
// Virtual mode nodes (id like "<cert>__exam") are skipped when resolving.
function currentCertId() {
  const n = state.navPath[1];
  return n ? n.id : null;
}
function currentCertLabel() {
  const n = state.navPath[1];
  return n ? n.label : null;
}
// Mode is "drill" if any node in the path is the topic_tests subtree (real id
// "topic_tests") or a virtual drill node; otherwise "exam".
function currentMode() {
  for (const n of state.navPath) {
    if (n.id === "topic_tests" || n._mode === "drill") return "drill";
    if (n._mode === "exam") return "exam";
  }
  return "exam";
}

// Derive cert id / mode for a saved record, backfilling old records that lack
// the fields by parsing the stored testPath (e.g.
// "aws/data_engineer_associate/topic_tests/compute/overview/test_1.json").
function recordCertId(rec) {
  if (rec.certId) return rec.certId;
  const parts = (rec.testPath || "").split("/");
  return parts.length >= 2 ? parts[1] : null;
}
function recordMode(rec) {
  if (rec.mode) return rec.mode;
  return (rec.testPath || "").includes("/topic_tests/") ? "drill" : "exam";
}
function recordCertLabel(rec) {
  if (rec.certLabel) return rec.certLabel;
  const id = recordCertId(rec);
  return id ? toLabel(id) : "Unknown";
}

async function saveSession() {
  const key = sessionKey();
  if (!key) return;
  const data = {
    answers: state.answers,
    current: state.current,
    feedbackOpen: state.feedbackOpen,
    timestamp: Date.now(),
  };
  // Always save to localStorage as fallback
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch (e) {
    /* quota exceeded — ignore */
  }
  // If authenticated, also save to Firestore
  if (state.user && window.firestoreSetDoc) {
    try {
      const docRef = window.firestoreDoc(
        window.firebaseDb,
        "users",
        state.user.uid,
        "sessions",
        key,
      );
      await window.firestoreSetDoc(docRef, data);
    } catch (e) {
      /* network error — localStorage fallback is fine */
    }
  }
}

async function loadSession() {
  const key = sessionKey();
  if (!key) return null;
  // If authenticated, try Firestore first
  if (state.user && window.firestoreGetDoc) {
    try {
      const docRef = window.firestoreDoc(
        window.firebaseDb,
        "users",
        state.user.uid,
        "sessions",
        key,
      );
      const snap = await window.firestoreGetDoc(docRef);
      if (snap.exists()) return snap.data();
    } catch (e) {
      /* fall through to localStorage */
    }
  }
  // Fallback to localStorage
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

async function clearSession() {
  const key = sessionKey();
  if (!key) return;
  localStorage.removeItem(key);
  // If authenticated, also clear from Firestore
  if (state.user && window.firestoreDeleteDoc) {
    try {
      const docRef = window.firestoreDoc(
        window.firebaseDb,
        "users",
        state.user.uid,
        "sessions",
        key,
      );
      await window.firestoreDeleteDoc(docRef);
    } catch (e) {
      /* ignore */
    }
  }
}

/* ─── Auth UI ───────────────────────────────────────────────────── */
function showAuthHeader(user) {
  const header = $("auth-header");
  const emailEl = $("auth-user-email");
  if (user) {
    // Display username (part before @)
    const username = user.email.split("@")[0];
    emailEl.textContent = username;
    header.classList.remove("hidden");
  } else {
    header.classList.add("hidden");
    emailEl.textContent = "";
  }
}

function showAuthView() {
  showView("auth");
  setBreadcrumb([]);
  state.authMode = "signin";
  updateAuthForm();
}

function updateAuthForm() {
  const submitBtn = $("auth-submit-btn");
  const toggleBtn = $("auth-toggle-btn");
  const errorEl = $("auth-error");
  errorEl.classList.add("hidden");
  if (state.authMode === "signin") {
    submitBtn.textContent = "Sign In";
    toggleBtn.textContent = "Create Account";
  } else {
    submitBtn.textContent = "Create Account";
    toggleBtn.textContent = "Back to Sign In";
  }
}

function toggleAuthMode() {
  state.authMode = state.authMode === "signin" ? "signup" : "signin";
  updateAuthForm();
}

async function handleAuthSubmit(e) {
  e.preventDefault();
  const email = $("auth-email").value.trim();
  const password = $("auth-password").value;
  const errorEl = $("auth-error");
  const submitBtn = $("auth-submit-btn");

  errorEl.classList.add("hidden");
  submitBtn.disabled = true;
  submitBtn.textContent = "Loading...";

  try {
    if (state.authMode === "signup") {
      await window.firebaseSignUp(email, password);
    } else {
      await window.firebaseSignIn(email, password);
    }
    // Auth state listener will handle the redirect
  } catch (err) {
    errorEl.textContent = friendlyAuthError(err.code);
    errorEl.classList.remove("hidden");
    submitBtn.disabled = false;
    updateAuthForm();
  }
}

function friendlyAuthError(code) {
  const map = {
    "auth/user-not-found": "No account found with this email.",
    "auth/wrong-password": "Incorrect password.",
    "auth/invalid-credential": "Invalid email or password.",
    "auth/email-already-in-use": "An account with this email already exists.",
    "auth/weak-password": "Password must be at least 6 characters.",
    "auth/invalid-email": "Please enter a valid email address.",
    "auth/too-many-requests": "Too many attempts. Please try again later.",
  };
  return map[code] || `Authentication error: ${code}`;
}

async function handleLogout() {
  try {
    await window.firebaseSignOut();
  } catch (e) {
    /* ignore */
  }
}

async function handleForgotPassword() {
  const email = $("auth-email").value.trim();
  const errorEl = $("auth-error");
  if (!email) {
    errorEl.textContent =
      "Enter your email address above, then click Forgot password.";
    errorEl.classList.remove("hidden");
    return;
  }
  try {
    await window.firebaseResetPassword(email);
    errorEl.textContent = "Password reset email sent. Check your inbox.";
    errorEl.classList.remove("hidden");
    errorEl.style.color = "#16a34a";
    errorEl.style.background = "#f0fdf4";
    errorEl.style.borderColor = "#dcfce7";
  } catch (err) {
    errorEl.style.color = "";
    errorEl.style.background = "";
    errorEl.style.borderColor = "";
    errorEl.textContent = friendlyAuthError(err.code);
    errorEl.classList.remove("hidden");
  }
}

function skipAuth() {
  renderHome();
}

function togglePasswordVisibility() {
  const input = $("auth-password");
  const icon = $("password-toggle-icon");
  if (input.type === "password") {
    input.type = "text";
    icon.textContent = "Hide";
  } else {
    input.type = "password";
    icon.textContent = "Show";
  }
}

function togglePasswordVisibility() {
  const input = $("auth-password");
  const icon = $("password-toggle-icon");
  if (input.type === "password") {
    input.type = "text";
    icon.textContent = "Hide";
  } else {
    input.type = "password";
    icon.textContent = "Show";
  }
}

/* ─── Firebase Auth State Listener ──────────────────────────────── */
window.onFirebaseAuthStateChanged = function (user) {
  state.user = user || null;
  showAuthHeader(user);
  if (user) {
    // User is authenticated — migrate any localStorage data, then go home
    migrateLocalData(user);
    const authView = $("view-auth");
    if (!authView.classList.contains("hidden")) {
      renderHome();
    }
  } else {
    // Not authenticated — show auth view
    showAuthView();
  }
};

/* ─── Migrate localStorage to Firestore on first sign-in ────────── */
async function migrateLocalData(user) {
  const migrationKey = `cert_migrated_${user.uid}`;
  if (localStorage.getItem(migrationKey)) return; // Already migrated

  // Migrate history
  try {
    const raw = localStorage.getItem("cert_history");
    if (raw && window.firestoreAddDoc) {
      const history = JSON.parse(raw);
      const colRef = window.firestoreCollection(
        window.firebaseDb,
        "users",
        user.uid,
        "history",
      );
      for (const record of history) {
        await window.firestoreAddDoc(colRef, record);
      }
    }
  } catch (e) {
    /* ignore migration errors */
  }

  // Migrate sessions
  try {
    const keys = Object.keys(localStorage).filter((k) =>
      k.startsWith("cert_session_"),
    );
    for (const key of keys) {
      const data = JSON.parse(localStorage.getItem(key));
      if (data && window.firestoreSetDoc) {
        const docRef = window.firestoreDoc(
          window.firebaseDb,
          "users",
          user.uid,
          "sessions",
          key,
        );
        await window.firestoreSetDoc(docRef, data);
      }
    }
  } catch (e) {
    /* ignore migration errors */
  }

  // Mark as migrated so we don't repeat
  localStorage.setItem(migrationKey, "true");
}

/* ─── Helpers ───────────────────────────────────────────────────── */
function $(id) {
  return document.getElementById(id);
}

function showView(name) {
  ["home", "topic", "tests", "exam", "report", "auth", "history"].forEach(
    (v) => {
      $(`view-${v}`).classList.toggle("hidden", v !== name);
    },
  );
  // The exam view needs extra width for the far-right question navigator.
  // Widen the app container only while the exam is showing; all other views
  // keep the default reading width.
  const app = document.getElementById("app");
  if (app) app.classList.toggle("app-wide", name === "exam");
}

function setBreadcrumb(crumbs) {
  // crumbs: [{ label, action? }]  — last item has no action.
  // Deep hierarchies (e.g. Home › AWS › Exam Prep › Cert › Domain › Task ›
  // Test › Q1) are collapsed: the first crumb and the last two stay visible,
  // and the middle levels fold behind a "…" button that expands on click.
  const nav = $("breadcrumb");
  if (!crumbs.length) {
    nav.classList.add("hidden");
    state._lastCrumbs = null;
    return;
  }
  nav.classList.remove("hidden");

  // Reset the expanded state whenever the breadcrumb trail changes (i.e. the
  // user navigated to a different view/question), so collapse is the default.
  const signature = crumbs.map((c) => c.label).join("|");
  if (signature !== state._breadcrumbSig) {
    state._breadcrumbSig = signature;
    state._breadcrumbExpanded = false;
  }
  state._lastCrumbs = crumbs;

  const sep = '<span class="sep" aria-hidden="true">›</span>';
  const crumbHTML = (c, i) => {
    const isLast = i === crumbs.length - 1;
    if (isLast || !c.action) {
      return `<span class="crumb current">${c.label}</span>`;
    }
    return `<a class="crumb" onclick="${c.action}">${c.label}</a>`;
  };

  // Collapse only when the chain is long enough to be noisy.
  const COLLAPSE_THRESHOLD = 5;
  const shouldCollapse =
    crumbs.length > COLLAPSE_THRESHOLD && !state._breadcrumbExpanded;

  let items;
  if (shouldCollapse) {
    // Keep index 0 (Home) and the last two crumbs; fold the rest.
    const ellipsis =
      '<button type="button" class="crumb crumb-ellipsis"' +
      ' aria-label="Show hidden breadcrumb levels" title="Show all levels"' +
      ' onclick="expandBreadcrumb()">…</button>';
    items = [
      crumbHTML(crumbs[0], 0),
      ellipsis,
      crumbHTML(crumbs[crumbs.length - 2], crumbs.length - 2),
      crumbHTML(crumbs[crumbs.length - 1], crumbs.length - 1),
    ];
  } else {
    items = crumbs.map((c, i) => crumbHTML(c, i));
  }

  nav.innerHTML = items.join(sep);
}

// Expand a collapsed breadcrumb in place (no view re-render needed).
function expandBreadcrumb() {
  state._breadcrumbExpanded = true;
  if (state._lastCrumbs) setBreadcrumb(state._lastCrumbs);
}

function toLabel(id) {
  // Convert a folder id to a display label (mirror of manifest generator).
  if (!id) return "";
  const upper = new Set([
    "ai",
    "aws",
    "gcp",
    "iam",
    "vpc",
    "api",
    "sql",
    "ml",
    "dr",
    "ui",
    "ci",
    "cd",
    "ec2",
    "ecs",
    "ecr",
    "eks",
    "s3",
    "rds",
  ]);
  return id
    .replace(/[-_]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) =>
      upper.has(w.toLowerCase())
        ? w.toUpperCase()
        : w.charAt(0).toUpperCase() + w.slice(1),
    )
    .join(" ");
}

function countCorrect(question, selected) {
  if (!selected || selected.length === 0) return false;
  const correct = new Set(question.correct);
  const sel = new Set(selected);
  return correct.size === sel.size && [...correct].every((k) => sel.has(k));
}

function requiredCount(question) {
  // parse "Select TWO" / "Select THREE" from stem
  // applies to both type='multi' and type='scenario' with multi-select stems
  if (question.type === "single") return 1;
  const m = question.stem.match(/select\s+(two|three)/i);
  if (!m) return question.correct.length;
  return m[1].toLowerCase() === "two" ? 2 : 3;
}

/* ─── Fetch helpers ─────────────────────────────────────────────── */
async function fetchJSON(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Failed to load ${path} (${res.status})`);
  return res.json();
}

/* ─── HOME VIEW ─────────────────────────────────────────────────── */
async function renderHome() {
  showView("home");
  state.navPath = [];
  setBreadcrumb([]);
  const el = $("view-home");
  el.innerHTML = `
    <h1 class="page-title">Certification Practice</h1>
    <p class="page-subtitle">Select a certification to begin</p>
    <p class="disclaimer">These questions are based on official documentation that may change over time. Some answers may not reflect the latest documentation when you use them.</p>
    <div class="state-msg">Loading...</div>`;

  try {
    state.manifest = await fetchJSON("manifest.json");
    state._historyCache = await loadHistory();
  } catch (e) {
    el.innerHTML = `
      <h1 class="page-title">Certification Practice</h1>
      <p class="disclaimer">These questions are based on official documentation that may change over time. Some answers may not reflect the latest documentation when you use them.</p>
      <div class="state-msg error">Could not load manifest.json.<br>${e.message}</div>`;
    return;
  }

  const providers = state.manifest.providers;
  if (!providers || providers.length === 0) {
    el.innerHTML = `
      <h1 class="page-title">Certification Practice</h1>
      <div class="state-msg">No certifications found in manifest.json.</div>`;
    return;
  }

  el.innerHTML = `
    <h1 class="page-title">Certification Practice</h1>
    <p class="page-subtitle">Select a certification to begin</p>
    <p class="disclaimer">These questions are based on official documentation that may change over time. Some answers may not reflect the latest documentation when you use them.</p>
    <div class="home-actions">
      <button class="btn btn-secondary btn-sm" onclick="renderHistory()">History</button>
    </div>
    <div class="card-grid">
      ${providers
        .map(
          (p) => `
        <div class="card" onclick="navigateTo('${p.id}', 0)">
          <div class="card-title">${p.label}</div>
          <div class="card-meta">${nodeMetaText(p)}</div>
          ${
            p.description ? `<div class="card-desc">${p.description}</div>` : ""
          }
        </div>`,
        )
        .join("")}
    </div>`;
}

/* ─── NAVIGATION HELPERS ────────────────────────────────────────── */
function countTests(node) {
  let count = 0;
  if (node.tests) count += node.tests.length;
  if (node.children) node.children.forEach((c) => (count += countTests(c)));
  return count;
}

function nodeMetaText(node) {
  // Show the immediate children count with appropriate label
  // If node has children, describe them (topics, domains, tasks, etc.)
  // If node is a leaf (tests only), show test count
  const hasChildren = node.children && node.children.length > 0;
  const hasTests = node.tests && node.tests.length > 0;

  if (hasChildren) {
    const count = node.children.length;
    // Infer the child type from the first child's id
    const firstChildId = node.children[0].id || "";
    let unit = "topic";
    if (firstChildId.startsWith("domain")) unit = "domain";
    else if (firstChildId.startsWith("task")) unit = "task";
    return `${count} ${unit}${count !== 1 ? "s" : ""}`;
  }

  if (hasTests) {
    const count = node.tests.length;
    return `${count} test${count !== 1 ? "s" : ""}`;
  }

  return "";
}

function findNodeAtDepth(depth, id) {
  // depth 0 = top-level providers
  if (depth === 0) {
    return state.manifest.providers.find((p) => p.id === id);
  }
  // Otherwise, look within the current navPath's last node's children
  const parent = state.navPath[depth - 1];
  if (!parent || !parent.children) return null;
  return parent.children.find((c) => c.id === id);
}

function navigateTo(id, depth) {
  const node = findNodeAtDepth(depth, id);
  if (!node) return;

  // Trim navPath to depth and push the new node
  state.navPath = state.navPath.slice(0, depth);
  state.navPath.push(node);

  renderNode();
}

function navigateToDepth(depth) {
  // Navigate back to a specific depth in the breadcrumb
  state.navPath = state.navPath.slice(0, depth + 1);
  renderNode();
}

/* ─── MODE SELECTION (Exam Prep vs Topic Drill) ─────────────────── */
// A certification shows the Mode Select screen whenever it has drill content
// (a `topic_tests` subtree). The screen presents whichever modes actually have
// content — so a cert with only drills still shows the two-mode model, and once
// Exam Prep content is added the other card appears automatically. Certs with
// ONLY exam content (existing Snowflake / Gen AI) never see the screen and
// behave exactly as before (backward compatible).
function modeChildren(node, mode) {
  if (!node.children) return [];
  return node.children.filter((c) => (c.mode || "exam") === mode);
}

function offersModeSelect(node) {
  // Only a certification node triggers Mode Select. The reliable structural
  // signal is a direct child folder named `topic_tests` (the drill root).
  // Descendant drill nodes (topics/content) must NOT re-trigger the screen.
  if (node._mode) return false; // already inside a chosen mode's virtual node
  if (!node.children) return false;
  return node.children.some((c) => c.id === "topic_tests");
}

const MODE_INFO = {
  exam: {
    label: "Exam Prep",
    desc: "Structured, blueprint-aligned practice organized by domain and task.",
  },
  drill: {
    label: "Topic Drill",
    desc: "Rapid-fire quick questions on the specific content you are studying now.",
  },
};

function renderModeSelect(node) {
  showView("topic");
  const crumbs = [{ label: "Home", action: "renderHome()" }];
  state.navPath.forEach((n, i) => {
    if (i < state.navPath.length - 1) {
      crumbs.push({ label: n.label, action: `navigateToDepth(${i})` });
    } else {
      crumbs.push({ label: n.label });
    }
  });
  setBreadcrumb(crumbs);

  let html = `<h1 class="page-title">${node.label}</h1>`;
  html += `<p class="page-subtitle">Choose a study mode</p>`;
  html += `<div class="home-actions"><button class="btn btn-secondary btn-sm" onclick="renderHistory('${node.id}','drill')">History</button></div>`;
  html += `<div class="card-grid">`;
  ["exam", "drill"].forEach((mode) => {
    const kids = modeChildren(node, mode);
    if (kids.length === 0) return;
    const info = MODE_INFO[mode];
    const total = kids.reduce((n, c) => n + countTests(c), 0);
    html += `
      <div class="card" onclick="selectMode('${mode}')">
        <div class="card-title">${info.label}</div>
        <div class="card-meta">${total} test${total !== 1 ? "s" : ""}</div>
        <div class="card-desc">${info.desc}</div>
      </div>`;
  });
  html += `</div>`;
  $("view-topic").innerHTML = html;
}

function selectMode(mode) {
  const cert = state.navPath[state.navPath.length - 1];
  const kids = modeChildren(cert, mode);
  if (kids.length === 0) return;

  if (mode === "drill") {
    // Drill children live under the single `topic_tests` node — dive into it.
    // (There is exactly one drill child: the topic_tests folder.)
    if (kids.length === 1) {
      state.navPath.push(kids[0]);
      renderNode();
      return;
    }
  }
  // Exam mode (or multiple drill roots): present the mode's children as a
  // filtered virtual node so the generic renderer continues unchanged.
  const virtual = {
    id: `${cert.id}__${mode}`,
    label: MODE_INFO[mode].label,
    children: kids,
    _mode: mode,
  };
  state.navPath.push(virtual);
  renderNode();
}

/* ─── NODE VIEW (replaces topic + test list) ────────────────────── */
function renderNode() {
  const node = state.navPath[state.navPath.length - 1];

  // If this node is a certification with drill content, show Mode Select
  // instead of its raw (mixed) children.
  if (offersModeSelect(node)) {
    renderModeSelect(node);
    return;
  }

  const hasChildren = node.children && node.children.length > 0;
  const hasTests = node.tests && node.tests.length > 0;

  // Build breadcrumb
  const crumbs = [{ label: "Home", action: "renderHome()" }];
  state.navPath.forEach((n, i) => {
    if (i < state.navPath.length - 1) {
      crumbs.push({ label: n.label, action: `navigateToDepth(${i})` });
    } else {
      crumbs.push({ label: n.label });
    }
  });
  setBreadcrumb(crumbs);

  // If node has only tests (leaf), show test list
  if (hasTests && !hasChildren) {
    renderTestList(node);
    return;
  }

  // If node has only children, show children cards
  // If node has both, show children cards + tests below
  showView("topic");
  let html = `<h1 class="page-title">${node.label}</h1>`;

  if (hasChildren) {
    html += `<p class="page-subtitle">Select a topic</p>`;
    html += `<div class="card-grid">`;
    html += node.children
      .map(
        (c) => `
      <div class="card" onclick="navigateTo('${c.id}', ${
        state.navPath.length
      })">
        <div class="card-title">${c.label}</div>
        <div class="card-meta">${nodeMetaText(c)}</div>
        ${c.description ? `<div class="card-desc">${c.description}</div>` : ""}
      </div>`,
      )
      .join("");
    html += `</div>`;
  }

  if (hasTests) {
    html += `<div class="section-heading" style="margin-top:28px">Tests</div>`;
    html += buildTestListHTML(node.tests);
  }

  $("view-topic").innerHTML = html;
}

function buildTestListHTML(tests) {
  const history = state._historyCache || [];
  return `<div class="test-list">
    ${tests
      .map((t) => {
        const attempts = history.filter((h) => h.testPath === t.path);
        let badge = "";
        let actions = `<button class="btn btn-primary btn-sm" onclick="startTest('${t.id}')">Start</button>`;
        if (attempts.length > 0) {
          const best = Math.max(...attempts.map((a) => a.percentage));
          const bestCls =
            best >= 80 ? "score-high" : best >= 60 ? "score-mid" : "score-low";
          // index of most recent attempt in the full history array (for review)
          const lastIdx = history.indexOf(attempts[0]);
          badge = `<span class="test-done-badge ${bestCls}" title="Best score across ${
            attempts.length
          } attempt${attempts.length !== 1 ? "s" : ""}">Done · ${best}% · ${
            attempts.length
          } attempt${attempts.length !== 1 ? "s" : ""}</span>`;
          actions = `
            <button class="btn btn-secondary btn-sm" onclick="reviewHistoryRecord(${lastIdx})">Review</button>
            <button class="btn btn-primary btn-sm" onclick="startTest('${t.id}')">Retake</button>`;
        }
        return `
      <div class="test-row" id="row-${t.id}">
        <span class="test-row-label">${t.label} ${badge}</span>
        <span class="test-row-actions">${actions}</span>
      </div>`;
      })
      .join("")}
  </div>`;
}

function renderTestList(node) {
  showView("tests");

  // Breadcrumb already set by renderNode caller
  const crumbs = [{ label: "Home", action: "renderHome()" }];
  state.navPath.forEach((n, i) => {
    if (i < state.navPath.length - 1) {
      crumbs.push({ label: n.label, action: `navigateToDepth(${i})` });
    } else {
      crumbs.push({ label: n.label });
    }
  });
  setBreadcrumb(crumbs);

  $("view-tests").innerHTML = `
    <h1 class="page-title">${node.label}</h1>
    <p class="page-subtitle">Choose a test to begin</p>
    ${buildTestListHTML(node.tests)}`;
}

async function startTest(id) {
  const currentNode = state.navPath[state.navPath.length - 1];
  state.testMeta = currentNode.tests.find((t) => t.id === id);
  const row = $(`row-${id}`);
  const btn = row.querySelector("button");
  btn.disabled = true;
  btn.textContent = "Loading...";

  try {
    state.exam = await fetchJSON(state.testMeta.path);
  } catch (e) {
    btn.disabled = false;
    btn.textContent = "Start";
    const err = document.createElement("div");
    err.className = "test-row-error";
    err.textContent = `Error: ${e.message}`;
    row.appendChild(err);
    return;
  }

  // Check for saved session
  const saved = await loadSession();
  if (saved && saved.answers && saved.answers.some((a) => a.submitted)) {
    // Show resume prompt
    const answeredCount = saved.answers.filter((a) => a.submitted).length;
    const total = state.exam.questions.length;
    row.innerHTML = `
      <div class="resume-prompt">
        <p class="resume-msg">You have a saved session (${answeredCount}/${total} answered). Resume where you left off?</p>
        <div class="resume-actions">
          <button class="btn btn-primary btn-sm" onclick="resumeTest()">Resume</button>
          <button class="btn btn-secondary btn-sm" onclick="startFresh()">Start Fresh</button>
        </div>
      </div>`;
    return;
  }

  // Init fresh exam state
  initFreshExam();
}

async function resumeTest() {
  const saved = await loadSession();
  if (saved) {
    state.answers = saved.answers;
    state.current = saved.current;
    state.feedbackOpen =
      saved.feedbackOpen || new Array(state.exam.questions.length).fill(false);
  }
  renderExam();
}

function startFresh() {
  clearSession();
  initFreshExam();
}

function initFreshExam() {
  const n = state.exam.questions.length;
  state.answers = Array.from({ length: n }, () => ({
    selected: [],
    submitted: false,
  }));
  state.feedbackOpen = new Array(n).fill(false);
  state.current = 0;
  saveSession();
  renderExam();
}

/* ─── EXAM VIEW ─────────────────────────────────────────────────── */
function renderExam() {
  showView("exam");
  const crumbs = [{ label: "Home", action: "renderHome()" }];
  state.navPath.forEach((n, i) => {
    crumbs.push({ label: n.label, action: `navigateToDepth(${i})` });
  });
  crumbs.push({
    label: state.testMeta.label,
    action: `navigateToDepth(${state.navPath.length - 1})`,
  });
  crumbs.push({ label: `Q${state.current + 1}` });
  setBreadcrumb(crumbs);
  renderQuestion(state.current);
}

function renderQuestion(idx) {
  const q = state.exam.questions[idx];
  const ans = state.answers[idx];
  const total = state.exam.questions.length;
  const req = requiredCount(q);
  const isLast = idx === total - 1;

  // Header
  const header = `
    <div class="exam-header">
      <span class="exam-progress">Question ${idx + 1} of ${total}</span>
      <span class="domain-badge">${q.domain}</span>
    </div>`;

  // Scenario
  const scenario = q.scenario
    ? `<div class="scenario-block">${q.scenario}</div>`
    : "";

  // Multi-select instruction (multi type, or scenario with multiple correct answers)
  const isMulti = q.type === "multi" || (q.type === "scenario" && req > 1);
  const instruction = isMulti
    ? `<div class="select-instruction">Select ${
        req === 2 ? "TWO" : "THREE"
      }</div>`
    : "";

  // Input type: checkbox for any question requiring multiple selections
  const inputType = isMulti ? "checkbox" : "radio";

  // Options
  const optionsHTML = q.options
    .map((opt) => {
      const isSelected = ans.selected.includes(opt.key);
      const isCorrect = q.correct.includes(opt.key);

      let stateClass = "";
      let missedHTML = "";
      let inputChecked = isSelected ? "checked" : "";
      let lockedAttr = ans.submitted ? "disabled" : "";

      if (ans.submitted) {
        if (isCorrect && isSelected) stateClass = "correct-selected";
        else if (!isCorrect && isSelected) stateClass = "incorrect-selected";
        else if (isCorrect && !isSelected) {
          stateClass = "correct-missed";
          missedHTML = `<div class="missed-label">Missed Correct Answer</div>`;
        }
      }

      const changeHandler = ans.submitted
        ? ""
        : `onchange="handleSelect(${idx}, '${opt.key}', this)"`;

      return `
      <li class="option-item ${stateClass} ${ans.submitted ? "locked" : ""}"
          onclick="${ans.submitted ? "" : `clickOption(${idx}, '${opt.key}')`}">
        <input type="${inputType}" name="q${idx}" value="${opt.key}"
               ${inputChecked} ${lockedAttr} ${changeHandler}
               id="opt-${idx}-${opt.key}" />
        <span class="option-key">${opt.key}.</span>
        <div>
          <div class="option-text">${opt.text}</div>
          ${missedHTML}
        </div>
      </li>`;
    })
    .join("");

  // Feedback (shown after submission)
  let feedbackHTML = "";
  if (ans.submitted) {
    const distractors = Object.entries(q.explanation.distractors)
      .map(
        ([key, text]) => `
        <div class="distractor-item">
          <span class="distractor-key">${key}.</span>${text}
        </div>`,
      )
      .join("");

    const feedbackBody = `
      <div class="feedback-block" id="fb-body-${idx}"
           ${state.feedbackOpen[idx] ? "" : 'style="display:none"'}>
        <div class="feedback-correct">
          <strong>✓ Correct Answer:</strong> ${q.explanation.correct}
        </div>
        <div class="distractor-list">${distractors}</div>
      </div>`;

    // On revisited questions default collapsed; on fresh submit default open
    const freshSubmit = !state.feedbackOpen[idx] && ans.submitted;
    const btnLabel = state.feedbackOpen[idx]
      ? "Hide Feedback"
      : "Show Feedback";

    feedbackHTML = `
      <div class="feedback-toggle">
        <button class="btn btn-secondary btn-sm"
                onclick="toggleFeedback(${idx})" id="fb-btn-${idx}">
          ${btnLabel}
        </button>
      </div>
      ${feedbackBody}`;
  }

  // Submit / Next / Results button
  let actionBtn = "";
  if (!ans.submitted) {
    const canSubmit = ans.selected.length === req;
    actionBtn = `
      <button class="btn btn-primary" id="submit-btn"
              onclick="submitAnswer(${idx})" ${canSubmit ? "" : "disabled"}>
        Submit
      </button>`;
  } else if (isLast) {
    actionBtn = `
      <button class="btn btn-primary" onclick="renderReport()">
        View Results
      </button>`;
  } else {
    actionBtn = `
      <button class="btn btn-primary" onclick="goNext()">
        Next
      </button>`;
  }

  const prevBtn = `
    <button class="btn btn-secondary" onclick="goPrev()" ${
      idx === 0 ? "disabled" : ""
    }>
      Previous
    </button>`;

  $("view-exam").innerHTML = `
    ${header}
    <div class="exam-layout">
      <div class="exam-main">
        <div class="question-card">
          ${scenario}
          <div class="question-stem">${q.stem}</div>
          ${instruction}
          <ul class="options-list">${optionsHTML}</ul>
          ${feedbackHTML}
        </div>
        <div class="exam-nav">
          ${prevBtn}
          ${actionBtn}
        </div>
      </div>
      ${buildNavigator(idx)}
    </div>`;
}

function clickOption(idx, key) {
  // Clicking the label area — proxy to the input
  const input = document.getElementById(`opt-${idx}-${key}`);
  if (input) input.click();
}

function handleSelect(idx, key, inputEl) {
  const q = state.exam.questions[idx];
  const ans = state.answers[idx];
  const req = requiredCount(q);

  if (req > 1) {
    if (inputEl.checked) {
      if (!ans.selected.includes(key)) ans.selected.push(key);
    } else {
      ans.selected = ans.selected.filter((k) => k !== key);
    }
  } else {
    ans.selected = [key];
  }

  // Update submit button state
  const btn = document.getElementById("submit-btn");
  if (btn) btn.disabled = ans.selected.length !== req;
}

function submitAnswer(idx) {
  state.answers[idx].submitted = true;
  state.feedbackOpen[idx] = true; // open by default on fresh submit
  saveSession();
  renderQuestion(idx);
  // scroll to top of question card
  $("view-exam").scrollIntoView({ behavior: "smooth", block: "start" });
}

function toggleFeedback(idx) {
  state.feedbackOpen[idx] = !state.feedbackOpen[idx];
  const body = document.getElementById(`fb-body-${idx}`);
  const btn = document.getElementById(`fb-btn-${idx}`);
  if (body) body.style.display = state.feedbackOpen[idx] ? "" : "none";
  if (btn)
    btn.textContent = state.feedbackOpen[idx]
      ? "Hide Feedback"
      : "Show Feedback";
}

function goNext() {
  if (state.current < state.exam.questions.length - 1) {
    state.current++;
    saveSession();
    renderQuestion(state.current);
    $("view-exam").scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function goPrev() {
  if (state.current > 0) {
    state.current--;
    saveSession();
    renderQuestion(state.current);
    $("view-exam").scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

// Jump directly to a question via the navigator grid. Allowed only for
// questions the user has already answered (submitted) or the current question;
// unanswered future questions are disabled in the UI and rejected here too.
function goToQuestion(idx) {
  if (idx < 0 || idx >= state.exam.questions.length) return;
  const canJump = idx === state.current || state.answers[idx].submitted;
  if (!canJump) return;
  state.current = idx;
  saveSession();
  renderQuestion(state.current);
  $("view-exam").scrollIntoView({ behavior: "smooth", block: "start" });
}

// Build the question-navigator grid: answered questions are clickable jump
// targets, the current question is highlighted, and unanswered ones are
// greyed out / disabled.
function buildNavigator(activeIdx) {
  const buttons = state.exam.questions
    .map((_, i) => {
      const ans = state.answers[i];
      const isCurrent = i === activeIdx;
      const isAnswered = ans.submitted;
      const clickable = isAnswered || isCurrent;
      const classes = [
        "nav-q",
        isCurrent ? "nav-q-current" : "",
        isAnswered ? "nav-q-answered" : "nav-q-unanswered",
      ]
        .filter(Boolean)
        .join(" ");
      const disabled = clickable ? "" : "disabled";
      const aria = isCurrent
        ? 'aria-current="true"'
        : isAnswered
          ? ""
          : 'aria-disabled="true"';
      return `<button type="button" class="${classes}" ${disabled} ${aria}
        onclick="goToQuestion(${i})"
        title="Question ${i + 1}${
          isAnswered
            ? " (answered)"
            : isCurrent
              ? " (current)"
              : " (not yet answered)"
        }">${i + 1}</button>`;
    })
    .join("");

  return `
    <aside class="q-navigator" aria-label="Question navigator">
      <div class="q-navigator-title">Questions</div>
      <div class="q-navigator-grid">${buttons}</div>
      <div class="q-navigator-legend">
        <span class="legend-item"><span class="legend-swatch legend-answered"></span>Answered</span>
        <span class="legend-item"><span class="legend-swatch legend-current"></span>Current</span>
        <span class="legend-item"><span class="legend-swatch legend-unanswered"></span>Locked</span>
      </div>
    </aside>`;
}

/* ─── Performance History ────────────────────────────────────────── */
async function saveHistory() {
  const questions = state.exam.questions;
  const total = questions.length;

  let score = 0;
  const perQuestionResults = questions.map((q, i) => {
    const isCorrect = countCorrect(q, state.answers[i].selected);
    if (isCorrect) score++;
    return {
      questionId: q.id,
      domain: q.domain,
      correct: isCorrect,
      userAnswer: state.answers[i].selected,
      correctAnswer: q.correct,
    };
  });

  const domainBreakdown = {};
  questions.forEach((q, i) => {
    if (!domainBreakdown[q.domain])
      domainBreakdown[q.domain] = { correct: 0, total: 0 };
    domainBreakdown[q.domain].total++;
    if (countCorrect(q, state.answers[i].selected))
      domainBreakdown[q.domain].correct++;
  });

  const record = {
    testPath: state.testMeta.path,
    testLabel: state.testMeta.label,
    topic: state.exam.topic,
    provider: state.navPath[0] ? state.navPath[0].id : null,
    certId: currentCertId(),
    certLabel: currentCertLabel(),
    mode: currentMode(),
    score,
    total,
    percentage: Math.round((score / total) * 100),
    domainBreakdown,
    perQuestionResults,
    completedAt: Date.now(),
  };

  // Save to localStorage (capped at 100 entries)
  try {
    const raw = localStorage.getItem("cert_history");
    const history = raw ? JSON.parse(raw) : [];
    history.unshift(record);
    if (history.length > 100) history.length = 100;
    localStorage.setItem("cert_history", JSON.stringify(history));
  } catch (e) {
    /* ignore */
  }

  // Save to Firestore if authenticated
  if (state.user && window.firestoreAddDoc) {
    try {
      const colRef = window.firestoreCollection(
        window.firebaseDb,
        "users",
        state.user.uid,
        "history",
      );
      await window.firestoreAddDoc(colRef, record);
    } catch (e) {
      /* network error — localStorage has it */
    }
  }

  // Refresh the in-memory cache so completion badges reflect this attempt.
  // Prepend locally to avoid an extra round-trip; matches unshift order above.
  if (Array.isArray(state._historyCache)) {
    state._historyCache.unshift(record);
  } else {
    state._historyCache = [record];
  }
}

async function loadHistory() {
  // If authenticated, load from Firestore
  if (state.user && window.firestoreGetDocs) {
    try {
      const colRef = window.firestoreCollection(
        window.firebaseDb,
        "users",
        state.user.uid,
        "history",
      );
      const q = window.firestoreQuery(
        colRef,
        window.firestoreOrderBy("completedAt", "desc"),
      );
      const snap = await window.firestoreGetDocs(q);
      const results = [];
      snap.forEach((doc) => results.push(doc.data()));
      return results;
    } catch (e) {
      /* fall through to localStorage */
    }
  }
  // Fallback to localStorage
  try {
    const raw = localStorage.getItem("cert_history");
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

/* ─── HISTORY VIEW ──────────────────────────────────────────────── */
// Build stats + attempt list HTML for a set of records. `allHistory` is the
// full array so per-item indices map correctly for review.
function historySectionHTML(records, allHistory, emptyMsg) {
  if (records.length === 0) {
    return `<p class="state-msg">${emptyMsg}</p>`;
  }

  const totalTests = records.length;
  const avgScore = Math.round(
    records.reduce((sum, h) => sum + h.percentage, 0) / totalTests,
  );

  // Weakest domains across this set
  const domainAgg = {};
  records.forEach((h) => {
    if (h.domainBreakdown) {
      Object.entries(h.domainBreakdown).forEach(([domain, data]) => {
        if (!domainAgg[domain]) domainAgg[domain] = { correct: 0, total: 0 };
        domainAgg[domain].correct += data.correct;
        domainAgg[domain].total += data.total;
      });
    }
  });
  const weakDomains = Object.entries(domainAgg)
    .map(([d, v]) => ({
      domain: d,
      pct: Math.round((v.correct / v.total) * 100),
    }))
    .sort((a, b) => a.pct - b.pct)
    .slice(0, 5);

  const scoreCls = (p) =>
    p >= 80 ? "score-high" : p >= 60 ? "score-mid" : "score-low";
  const barCls = (p) =>
    p >= 80 ? "bar-high" : p >= 60 ? "bar-mid" : "bar-low";

  const items = records
    .map((h) => {
      const idx = allHistory.indexOf(h); // stable index into full history
      const date = new Date(h.completedAt).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
      });
      const time = new Date(h.completedAt).toLocaleTimeString("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
      });
      const domainBars = h.domainBreakdown
        ? Object.entries(h.domainBreakdown)
            .map(([d, v]) => {
              const dpct = Math.round((v.correct / v.total) * 100);
              return `<div class="history-domain-row">
              <span class="history-domain-name">${d}</span>
              <div class="history-bar-track">
                <div class="history-bar-fill ${barCls(
                  dpct,
                )}" style="width:${dpct}%"></div>
              </div>
              <span class="history-domain-score">${v.correct}/${v.total}</span>
            </div>`;
            })
            .join("")
        : "";
      return `
      <div class="history-item">
        <div class="history-item-header" onclick="toggleHistoryDetail(${idx})">
          <div class="history-item-info">
            <span class="history-item-label">${h.testLabel || h.topic}</span>
            <span class="history-item-date">${date} ${time}</span>
          </div>
          <div class="history-item-score ${scoreCls(h.percentage)}">${
            h.percentage
          }%
            <span class="history-item-raw">(${h.score}/${h.total})</span>
          </div>
        </div>
        <div class="history-item-detail hidden" id="history-detail-${idx}">
          ${domainBars}
          <div style="margin-top:8px"><button class="btn btn-secondary btn-sm" onclick="reviewHistoryRecord(${idx})">Review Answers</button></div>
        </div>
      </div>`;
    })
    .join("");

  const weakHTML =
    weakDomains.length > 0
      ? `<div class="section-heading">Areas to Improve</div>
       <div class="weak-domains">
         ${weakDomains
           .map(
             (d) =>
               `<div class="weak-domain-item"><span>${
                 d.domain
               }</span><span class="${scoreCls(d.pct)}">${d.pct}%</span></div>`,
           )
           .join("")}
       </div>`
      : "";

  return `
    <div class="history-stats">
      <div class="stat-card"><div class="stat-value">${totalTests}</div><div class="stat-label">Tests Taken</div></div>
      <div class="stat-card"><div class="stat-value">${avgScore}%</div><div class="stat-label">Average Score</div></div>
    </div>
    ${weakHTML}
    <div class="section-heading">All Attempts</div>
    <div class="history-list">${items}</div>`;
}

// Home history: global, EXAM (domain) results only, filterable by certification.
// Per-cert history: pass certId — shows Drill / Domain tabs for that cert.
async function renderHistory(certId, tab) {
  showView("history");
  const el = $("view-history");
  el.innerHTML = `<h1 class="page-title">Performance History</h1><div class="state-msg">Loading...</div>`;

  const history = state._historyCache || (await loadHistory());
  state._historyCache = history;

  if (certId) {
    return renderCertHistory(certId, tab || "drill", history);
  }

  // ── Home history: exam-only, cert dropdown filter ──
  setBreadcrumb([
    { label: "Home", action: "renderHome()" },
    { label: "History" },
  ]);

  const examRecords = history.filter((h) => recordMode(h) === "exam");

  // Cert dropdown options: only certs that have exam results
  const certMap = {};
  examRecords.forEach((h) => {
    const id = recordCertId(h);
    if (id && !certMap[id]) certMap[id] = recordCertLabel(h);
  });
  const selected = state._homeHistoryCert || "all";
  const optionsHTML =
    `<option value="all"${
      selected === "all" ? " selected" : ""
    }>All certifications</option>` +
    Object.entries(certMap)
      .map(
        ([id, label]) =>
          `<option value="${id}"${
            selected === id ? " selected" : ""
          }>${label}</option>`,
      )
      .join("");

  const filtered =
    selected === "all"
      ? examRecords
      : examRecords.filter((h) => recordCertId(h) === selected);

  el.innerHTML = `
    <h1 class="page-title">Performance History</h1>
    <p class="page-subtitle">Exam Prep results across your certifications</p>
    <div class="history-filter">
      <label for="home-hist-cert">Certification:</label>
      <select id="home-hist-cert" onchange="onHomeHistoryCertChange(this.value)">${optionsHTML}</select>
    </div>
    ${historySectionHTML(filtered, history, "No Exam Prep attempts yet.")}`;
}

function onHomeHistoryCertChange(value) {
  state._homeHistoryCert = value;
  renderHistory();
}

// Per-certification history with Drill / Domain tabs (separate aggregation).
function renderCertHistory(certId, tab, history) {
  const el = $("view-history");
  const certLabel =
    history.find((h) => recordCertId(h) === certId)?.certLabel ||
    recordCertLabel({ certId }) ||
    toLabel(certId);

  setBreadcrumb([
    { label: "Home", action: "renderHome()" },
    { label: certLabel + " — History" },
  ]);

  const certRecords = history.filter((h) => recordCertId(h) === certId);
  const drillRecords = certRecords.filter((h) => recordMode(h) === "drill");
  const examRecords = certRecords.filter((h) => recordMode(h) === "exam");

  const activeDrill = tab === "drill";
  const body = activeDrill
    ? historySectionHTML(
        drillRecords,
        history,
        "No Topic Drill attempts yet for this certification.",
      )
    : historySectionHTML(
        examRecords,
        history,
        "No Exam Prep attempts yet for this certification.",
      );

  el.innerHTML = `
    <h1 class="page-title">${certLabel} — History</h1>
    <div class="history-tabs">
      <button class="tab-btn ${
        activeDrill ? "active" : ""
      }" onclick="renderHistory('${certId}','drill')">Topic Drill (${
        drillRecords.length
      })</button>
      <button class="tab-btn ${
        !activeDrill ? "active" : ""
      }" onclick="renderHistory('${certId}','exam')">Exam Prep (${
        examRecords.length
      })</button>
    </div>
    ${body}`;
}

function toggleHistoryDetail(idx) {
  const detail = document.getElementById(`history-detail-${idx}`);
  if (detail) detail.classList.toggle("hidden");
}

/* ─── REPORT VIEW ───────────────────────────────────────────────── */
// Build the report body HTML from questions + answers. Reused by the live
// report (after finishing a test) and the read-only historical review.
// answers: [{ selected: [...keys] }]  (submitted flag not needed here)
function buildReportBody(topic, questions, answers, opts = {}) {
  const total = questions.length;
  let score = 0;
  questions.forEach((q, i) => {
    if (countCorrect(q, answers[i].selected)) score++;
  });
  const pct = total ? Math.round((score / total) * 100) : 0;

  const domainMap = {};
  questions.forEach((q, i) => {
    if (!domainMap[q.domain]) domainMap[q.domain] = { correct: 0, total: 0 };
    domainMap[q.domain].total++;
    if (countCorrect(q, answers[i].selected)) domainMap[q.domain].correct++;
  });
  const domainRows = Object.entries(domainMap)
    .map(([d, v]) => {
      const missed = v.correct < v.total;
      return `<tr class="domain-row ${missed ? "missed" : ""}">
      <td>${d}</td>
      <td>${v.correct} / ${v.total}</td>
    </tr>`;
    })
    .join("");

  const reviewItems = questions
    .map((q, i) => {
      const ans = answers[i];
      const isCorrect = countCorrect(q, ans.selected);
      const userKeys = ans.selected.join(", ") || "—";
      const correctKeys = q.correct.join(", ");
      const scenarioHTML = q.scenario
        ? `<div class="scenario-block" style="margin-bottom:10px">${q.scenario}</div>`
        : "";
      const optionReviews = q.options
        .map((opt) => {
          const isUserSel = ans.selected.includes(opt.key);
          const isAnsCorrect = q.correct.includes(opt.key);
          let cls = "";
          if (isAnsCorrect) cls = "opt-correct";
          else if (isUserSel && !isAnsCorrect) cls = "opt-wrong";
          const explanation = isAnsCorrect
            ? q.explanation.correct
            : q.explanation.distractors[opt.key] || "";
          return `<div class="review-option ${cls}">
        <strong>${opt.key}. ${opt.text}</strong>
        ${
          explanation
            ? `<div style="margin-top:4px;color:var(--text-muted)">${explanation}</div>`
            : ""
        }
      </div>`;
        })
        .join("");
      return `
      <div class="review-item ${isCorrect ? "correct" : "incorrect"}">
        <div class="review-meta">
          <span class="review-number">Q${i + 1}</span>
          <span class="domain-badge">${q.domain}</span>
          <span class="status-pill ${isCorrect ? "correct" : "incorrect"}">
            ${isCorrect ? "Correct" : "Incorrect"}
          </span>
        </div>
        ${scenarioHTML}
        <div class="review-stem">${q.stem}</div>
        <div class="review-answers">
          Your answer: <span>${userKeys}</span> &nbsp;|&nbsp;
          Correct: <span>${correctKeys}</span>
        </div>
        <div class="review-explanation">${q.explanation.correct}</div>
        <div class="review-options">${optionReviews}</div>
      </div>`;
    })
    .join("");

  const actions = opts.readOnly
    ? `<div class="report-actions">
         <button class="btn btn-secondary" onclick="renderHistory()">Back to History</button>
         <button class="btn btn-primary" onclick="downloadPDF()">Download Report</button>
       </div>`
    : `<div class="report-actions">
         <button class="btn btn-secondary" onclick="retakeTest()">Retake Test</button>
         <button class="btn btn-primary"   onclick="downloadPDF()">Download Report</button>
       </div>`;

  return `
    <div class="report-header">
      <div class="page-title">${topic}${opts.readOnly ? " — Review" : ""}</div>
      <div class="score-display">${score} / ${total}</div>
      <div class="score-pct">${pct}%</div>
    </div>

    <div class="section-heading">Domain Analysis</div>
    <table class="domain-table">
      <thead><tr><th>Domain</th><th>Score</th></tr></thead>
      <tbody>${domainRows}</tbody>
    </table>

    <div class="section-heading">Question Review</div>
    ${reviewItems}

    ${actions}`;
}

function renderReport() {
  clearSession(); // Test complete — no need to resume
  saveHistory(); // Persist results for performance tracking
  showView("report");
  const crumbs = [{ label: "Home", action: "renderHome()" }];
  state.navPath.forEach((n, i) => {
    crumbs.push({ label: n.label, action: `navigateToDepth(${i})` });
  });
  crumbs.push({
    label: state.testMeta.label,
    action: `navigateToDepth(${state.navPath.length - 1})`,
  });
  crumbs.push({ label: "Results" });
  setBreadcrumb(crumbs);

  $("view-report").innerHTML = buildReportBody(
    state.exam.topic,
    state.exam.questions,
    state.answers,
  );
}

/* ─── READ-ONLY HISTORICAL REVIEW ───────────────────────────────── */
// Re-fetch the test JSON by its stored path, merge saved answers, and render a
// locked, read-only report. Falls back gracefully if the test file is missing.
async function reviewHistoryRecord(idx) {
  const history = state._historyCache || (await loadHistory());
  const rec = history[idx];
  if (!rec) return;

  showView("report");
  setBreadcrumb([
    { label: "Home", action: "renderHome()" },
    { label: "History", action: "renderHistory()" },
    { label: "Review" },
  ]);
  $("view-report").innerHTML = `<div class="state-msg">Loading review…</div>`;

  let exam;
  try {
    exam = await fetchJSON(rec.testPath);
  } catch (e) {
    $("view-report").innerHTML = `
      <div class="report-header"><div class="page-title">${
        rec.testLabel || rec.topic
      } — Review</div></div>
      <div class="state-msg error">This test file could not be loaded (it may have been moved or removed), so a full question review isn't available.<br>Recorded score: ${
        rec.score
      }/${rec.total} (${rec.percentage}%).</div>
      <div class="report-actions"><button class="btn btn-secondary" onclick="renderHistory()">Back to History</button></div>`;
    return;
  }

  // Rebuild an answers array aligned to the exam questions from perQuestionResults.
  const byId = {};
  (rec.perQuestionResults || []).forEach((r) => {
    byId[r.questionId] = r.userAnswer || [];
  });
  const answers = exam.questions.map((q) => ({
    selected: byId[q.id] || [],
  }));

  $("view-report").innerHTML = buildReportBody(
    exam.topic,
    exam.questions,
    answers,
    {
      readOnly: true,
    },
  );
}

function retakeTest() {
  clearSession();
  const n = state.exam.questions.length;
  state.answers = Array.from({ length: n }, () => ({
    selected: [],
    submitted: false,
  }));
  state.feedbackOpen = new Array(n).fill(false);
  state.current = 0;
  renderExam();
}

/* ─── PDF EXPORT ────────────────────────────────────────────────── */
function downloadPDF() {
  const reportEl = $("view-report");
  const filename = `${state.exam.topic.replace(/\s+/g, "_")}_report.pdf`;

  // Temporarily hide the action buttons so they don't appear in the PDF
  const actions = reportEl.querySelector(".report-actions");
  if (actions) actions.style.display = "none";

  const opt = {
    margin: [10, 10, 10, 10],
    filename: filename,
    image: { type: "jpeg", quality: 0.95 },
    html2canvas: { scale: 2, useCORS: true, scrollY: 0 },
    jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
    pagebreak: { mode: ["avoid-all", "css", "legacy"] },
  };

  html2pdf()
    .set(opt)
    .from(reportEl)
    .save()
    .then(() => {
      if (actions) actions.style.display = "";
    })
    .catch(() => {
      if (actions) actions.style.display = "";
    });
}

/* ─── Boot ──────────────────────────────────────────────────────── */
document.addEventListener("DOMContentLoaded", () => {
  // Show auth view by default — Firebase auth state listener
  // will redirect to home once authentication is confirmed
  showAuthView();
});
