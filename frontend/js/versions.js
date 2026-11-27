
"use strict";

// ==========================================
// SUPPORT HUB - ARTICLE VERSION HISTORY
// ==========================================

let currentArticleId = null;
let savedVersions = [];

// ------------------------------------------
// 1. HELPERS
// ------------------------------------------

function versionMessage(text) {
  const element = document.getElementById(
    "version-message"
  );

  if (element) {
    element.textContent = text;
  }
}

function validArticleId(value) {
  const id = Number(value);

  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new Error("Enter a valid Article ID");
  }

  return id;
}

function clearVersionResults() {
  savedVersions = [];

  document.getElementById(
    "versions-list"
  ).replaceChildren();

  document.getElementById(
    "comparison-result"
  ).replaceChildren();

  document.getElementById(
    "comparison-result"
  ).hidden = true;

  for (const id of [
    "compare-from",
    "compare-to",
    "restore-version"
  ]) {
    const select = document.getElementById(id);

    select.replaceChildren();

    const option = document.createElement("option");

    option.value = "";
    option.textContent = "Select version";

    select.appendChild(option);
  }
}

// ------------------------------------------
// 2. ADD VERSION OPTIONS
// ------------------------------------------

function addVersionOption(select, version) {
  const option = document.createElement("option");

  // The API expects version_id, not version_number.
  option.value = String(version.version_id);

  option.textContent =
    "Version " + version.version_number;

  select.appendChild(option);
}

// ------------------------------------------
// 3. LOAD VERSION HISTORY
// ------------------------------------------

async function loadVersions(articleId) {
  clearVersionResults();

  currentArticleId = validArticleId(articleId);

  versionMessage("Loading versions...");

  const result = await api(
    "/articles/" +
    currentArticleId +
    "/versions"
  );

  savedVersions = result.versions || [];

  const tbody = document.getElementById(
    "versions-list"
  );

  const fromSelect = document.getElementById(
    "compare-from"
  );

  const toSelect = document.getElementById(
    "compare-to"
  );

  const restoreSelect = document.getElementById(
    "restore-version"
  );

  if (savedVersions.length === 0) {
    versionMessage("No versions found.");
    return;
  }

  for (const version of savedVersions) {
    const row = document.createElement("tr");

    const numberCell = document.createElement("td");

    numberCell.textContent =
      "Version " + version.version_number;

    const dateCell = document.createElement("td");

    dateCell.textContent = new Date(
      version.created_at
    ).toLocaleString();

    const actionCell = document.createElement("td");

    const viewButton = document.createElement("button");

    viewButton.type = "button";
    viewButton.textContent = "View";

    viewButton.addEventListener("click", async () => {
      try {
        const details = await api(
          "/articles/" +
          currentArticleId +
          "/versions/" +
          version.version_id
        );

        const articleVersion = details.version;

        const resultBox = document.getElementById(
          "comparison-result"
        );

        resultBox.replaceChildren();

        const heading = document.createElement("h3");

        heading.textContent =
          "Version " + articleVersion.version_number;

        const title = document.createElement("p");

        title.textContent =
          "Title: " + articleVersion.title;

        const content = document.createElement("p");

        content.textContent = articleVersion.content;

        resultBox.append(
          heading,
          title,
          content
        );

        resultBox.hidden = false;

        versionMessage("Version loaded.");

      } catch (error) {
        versionMessage(error.message);
      }
    });

    actionCell.appendChild(viewButton);

    row.append(
      numberCell,
      dateCell,
      actionCell
    );

    tbody.appendChild(row);

    addVersionOption(fromSelect, version);
    addVersionOption(toSelect, version);
    addVersionOption(restoreSelect, version);
  }

  // Select the oldest and newest versions by default.
  const sorted = [...savedVersions].sort(
    (a, b) =>
      Number(a.version_number) -
      Number(b.version_number)
  );

  if (sorted.length >= 2) {
    fromSelect.value = String(
      sorted[0].version_id
    );

    toSelect.value = String(
      sorted[sorted.length - 1].version_id
    );
  }

  versionMessage(
    savedVersions.length + " version(s) loaded."
  );
}

// ------------------------------------------
// 4. COMPARE TWO VERSIONS
// ------------------------------------------

async function compareVersions() {
  if (!currentArticleId) {
    versionMessage("Load an article first.");
    return;
  }

  const fromId = document.getElementById(
    "compare-from"
  ).value;

  const toId = document.getElementById(
    "compare-to"
  ).value;

  if (!fromId || !toId) {
    versionMessage("Select two versions.");
    return;
  }

  if (fromId === toId) {
    versionMessage("Choose two different versions.");
    return;
  }

  try {
    versionMessage("Comparing versions...");

    const result = await api(
      "/articles/" +
      currentArticleId +
      "/versions/compare?from=" +
      encodeURIComponent(fromId) +
      "&to=" +
      encodeURIComponent(toId)
    );

    const comparison = result.comparison;

    const resultBox = document.getElementById(
      "comparison-result"
    );

    resultBox.replaceChildren();

    function addLine(label, text) {
      const heading = document.createElement("h3");
      heading.textContent = label;

      const paragraph = document.createElement("p");
      paragraph.textContent = String(text ?? "");

      resultBox.append(heading, paragraph);
    }

    addLine(
      "Title Changed",
      comparison.titleChanged ? "Yes" : "No"
    );

    addLine(
      "Content Changed",
      comparison.contentChanged ? "Yes" : "No"
    );

    addLine(
      "Category Changed",
      comparison.categoryChanged ? "Yes" : "No"
    );

    addLine(
      "Before - Title",
      comparison.before.title
    );

    addLine(
      "Before - Content",
      comparison.before.content
    );

    addLine(
      "After - Title",
      comparison.after.title
    );

    addLine(
      "After - Content",
      comparison.after.content
    );

    resultBox.hidden = false;

    versionMessage("Comparison completed.");

  } catch (error) {
    versionMessage(error.message);
  }
}

// ------------------------------------------
// 5. RESTORE PREVIOUS VERSION
// ------------------------------------------

async function restoreVersion() {
  if (!currentArticleId) {
    versionMessage("Load an article first.");
    return;
  }

  const versionId = document.getElementById(
    "restore-version"
  ).value;

  if (!versionId) {
    versionMessage("Select a version to restore.");
    return;
  }

  const selected = savedVersions.find(
    version =>
      String(version.version_id) === versionId
  );

  const label = selected
    ? "Version " + selected.version_number
    : "the selected version";

  const confirmed = confirm(
    "Restore " + label + "?\n\n" +
    "This will update your draft and create " +
    "a new version history entry."
  );

  if (!confirmed) return;

  try {
    versionMessage("Restoring version...");

    await api(
      "/articles/" +
      currentArticleId +
      "/restore",
      {
        method: "POST",
        body: {
          versionId: Number(versionId)
        }
      }
    );

    await loadVersions(currentArticleId);

    versionMessage(
      "Version restored successfully. " +
      "A new history entry was created."
    );

  } catch (error) {
    versionMessage(error.message);
  }
}

// Restore the draft from the selected version's S3 backup.
async function restoreFromBackup() {
  if (!currentArticleId) {
    versionMessage("Load an article first.");
    return;
  }

  const versionId = document.getElementById(
    "restore-version"
  ).value;

  if (!versionId) {
    versionMessage("Select a version to restore.");
    return;
  }

  const confirmed = confirm(
    "Restore this version from its S3 backup?\n\n" +
    "This will update your draft and create " +
    "a new version history entry."
  );

  if (!confirmed) return;

  try {
    versionMessage("Restoring from S3 backup...");

    await api(
      "/articles/" +
      currentArticleId +
      "/versions/" +
      encodeURIComponent(versionId) +
      "/restore-backup",
      { method: "POST" }
    );

    await loadVersions(currentArticleId);

    versionMessage(
      "Draft restored from the S3 backup. " +
      "A new history entry was created."
    );

  } catch (error) {
    versionMessage(error.message);
  }
}

// ------------------------------------------
// 6. INITIALIZE PAGE
// ------------------------------------------

async function initializeVersionsPage() {
  const form = document.getElementById(
    "version-form"
  );

  if (!form) return;

  // Only authenticated authors/admins.
  await requireRole(["author", "admin"]);

  form.addEventListener("submit", async event => {
    event.preventDefault();

    const id = document.getElementById(
      "version-article-id"
    ).value;

    try {
      await loadVersions(id);
    } catch (error) {
      versionMessage(error.message);
    }
  });

  document.getElementById(
    "compare-button"
  ).addEventListener(
    "click",
    compareVersions
  );

  document.getElementById(
    "restore-button"
  ).addEventListener(
    "click",
    restoreVersion
  );

  document.getElementById(
    "restore-backup-button"
  ).addEventListener(
    "click",
    restoreFromBackup
  );

  // Support URLs such as:
  // versions.html?articleId=2

  const params = new URLSearchParams(
    window.location.search
  );

  const articleId = params.get("articleId");

  if (articleId) {
    document.getElementById(
      "version-article-id"
    ).value = articleId;

    try {
      await loadVersions(articleId);
    } catch (error) {
      versionMessage(error.message);
    }
  }
}

initializeVersionsPage().catch(error => {
  versionMessage(error.message);
});
