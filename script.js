const STORAGE_KEY = "cookbook";
const DB_NAME = "cookbook-pwa";
const DB_VERSION = 1;
const STORE_NAME = "app-state";
const COOKBOOK_RECORD_ID = "sections";

let sections = [];
let currentRecipe = null;
let currentSection = null;
let formMode = "add";
let tempImage = null; // temp image for form preview
let draggedRecipe = null;
let currentSearch = "";
let touchDraggingIndex = null;
let tocEditMode = false; // track TOC edit mode

// --------------------
// Persistence
// --------------------
function openDatabase() {
  return new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) {
      reject(new Error("IndexedDB is not available in this browser."));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Could not open cookbook storage."));
  });
}

async function loadCookbook() {
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readonly");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(COOKBOOK_RECORD_ID);

    request.onsuccess = () => {
      const saved = request.result?.sections;
      resolve(Array.isArray(saved) ? saved : []);
    };

    request.onerror = () => reject(request.error || new Error("Could not load cookbook."));
    transaction.oncomplete = () => db.close();
    transaction.onerror = () => db.close();
    transaction.onabort = () => db.close();
  });
}

async function saveCookbook() {
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    let requestFailed = false;
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put({
      id: COOKBOOK_RECORD_ID,
      sections,
      updatedAt: new Date().toISOString()
    });

    request.onerror = () => {
      requestFailed = true;
      reject(request.error || new Error("Could not save cookbook."));
    };
    transaction.oncomplete = () => {
      db.close();
      if (!requestFailed) resolve();
    };
    transaction.onerror = () => {
      db.close();
      if (!requestFailed) reject(transaction.error || new Error("Could not save cookbook."));
    };
    transaction.onabort = () => {
      db.close();
      if (!requestFailed) reject(transaction.error || new Error("Could not save cookbook."));
    };
  });
}

function loadLegacyCookbook() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
}

function saveData() {
  return saveCookbook()
    .then(() => true)
    .catch(error => {
      console.error(error);
      setStatus("Could not save. Your browser storage may be full.");
      return false;
    });
}

function ensureStarterSection() {
  if (sections.length > 0) return false;

  sections = [{
    id: Date.now().toString(),
    name: "Uncategorized",
    recipes: []
  }];
  saveData();
  return true;
}

async function migrateLegacyCookbookIfNeeded() {
  const legacySections = loadLegacyCookbook();

  if (sections.length > 0 || legacySections.length === 0) return;

  sections = legacySections;
  const saved = await saveData();

  if (saved) {
    localStorage.removeItem(STORAGE_KEY);
    setStatus("Cookbook moved to larger offline storage.");
  }
}

function cleanupLegacyImageCache() {
  Object.keys(localStorage)
    .filter(key => key.startsWith("recipe-img-"))
    .forEach(key => localStorage.removeItem(key));
}

function setStatus(message) {
  const status = document.getElementById("app-status");
  status.textContent = message;

  if (message) {
    window.clearTimeout(setStatus.timeoutId);
    setStatus.timeoutId = window.setTimeout(() => {
      status.textContent = "";
    }, 4000);
  }
}

function normalizeImportedSections(imported) {
  const importedSections = Array.isArray(imported)
    ? imported
    : imported?.sections;

  if (!Array.isArray(importedSections)) {
    throw new Error("Backup file does not contain cookbook sections.");
  }

  importedSections.forEach(section => {
    if (!section || typeof section.name !== "string" || !Array.isArray(section.recipes)) {
      throw new Error("Backup file does not match this cookbook format.");
    }
  });

  return importedSections;
}

function exportCookbook() {
  const backup = {
    exportedAt: new Date().toISOString(),
    sections
  };
  const blob = new Blob([JSON.stringify(backup, null, 2)], {
    type: "application/json"
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const date = new Date().toISOString().slice(0, 10);

  link.href = url;
  link.download = `cookbook-backup-${date}.json`;
  link.click();
  URL.revokeObjectURL(url);
  setStatus("Cookbook backup exported.");
}

document.getElementById("import-file").addEventListener("change", event => {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();

  reader.onload = async () => {
    try {
      const imported = JSON.parse(reader.result);
      sections = normalizeImportedSections(imported);
      ensureStarterSection();
      const saved = await saveData();
      if (!saved) return;
      renderCookbook();
      hideAllViews();
      document.getElementById("cookbook-view").classList.remove("hidden");
      setStatus("Cookbook backup imported.");
    } catch (error) {
      setStatus(error.message || "Could not import that backup file.");
    } finally {
      event.target.value = "";
    }
  };

  reader.onerror = () => {
    setStatus("Could not read that backup file.");
    event.target.value = "";
  };

  reader.readAsText(file);
});

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Could not read that image."));
    reader.readAsDataURL(file);
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not load that image."));
    image.src = src;
  });
}

async function prepareRecipeImage(file) {
  if (!file) return null;

  const original = await readFileAsDataUrl(file);
  const image = await loadImage(original);
  const maxSize = 1200;
  const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");

  canvas.width = width;
  canvas.height = height;
  context.drawImage(image, 0, 0, width, height);

  return canvas.toDataURL("image/jpeg", 0.78);
}

async function updateImagePreview(fileInput, preview, removeBtn) {
  const file = fileInput.files[0];

  if (!file) {
    tempImage = null;
    preview.src = "";
    preview.style.display = "none";
    removeBtn.style.display = "none";
    return;
  }

  try {
    setStatus("Preparing image...");
    tempImage = await prepareRecipeImage(file);
    preview.src = tempImage;
    preview.style.display = "block";
    removeBtn.style.display = "inline-block";
    setStatus("Image ready.");
  } catch (error) {
    tempImage = null;
    fileInput.value = "";
    preview.src = "";
    preview.style.display = "none";
    removeBtn.style.display = "none";
    setStatus(error.message || "Could not use that image.");
  }
}


// --------------------
// Rendering
// --------------------
function renderCookbook() {
  const container = document.getElementById("cookbook-view");
  container.innerHTML = "";

  sections.forEach(section => {
    const matchingRecipes = section.recipes.filter(recipe => {
      if (!currentSearch) return true;

      const nameMatch = recipe.name
        .toLowerCase()
        .includes(currentSearch);

      const ingredientMatch = recipe.ingredients.some(i =>
        i.toLowerCase().includes(currentSearch)
      );

      return nameMatch || ingredientMatch;
    });

    // ALWAYS render the section
    const sectionEl = document.createElement("section");
    sectionEl.id = `section-${section.id}`;

    const title = document.createElement("h2");
    title.textContent = section.name;
    sectionEl.appendChild(title);

    // If no matches
    if (matchingRecipes.length === 0) {
      // If searching → hide section completely
      if (currentSearch) return;

      // If not searching → show empty section
      const empty = document.createElement("p");
      empty.textContent = "No recipes yet";
      empty.style.fontStyle = "italic";
      empty.style.opacity = "0.6";
      sectionEl.appendChild(empty);

      container.appendChild(sectionEl);
      return;
    }


    matchingRecipes.forEach(recipe => {
      const recipeEl = document.createElement("div");
      recipeEl.className = "recipe";
      recipeEl.draggable = true;
      recipeEl.dataset.sectionId = section.id;
      recipeEl.dataset.recipeIndex = section.recipes.indexOf(recipe);

      recipeEl.style.display = "flex";
      recipeEl.style.alignItems = "center";
      recipeEl.style.gap = "8px";
      recipeEl.style.cursor = "pointer";

      if (recipe.image) {
        const img = document.createElement("img");
        img.src = recipe.image;
        img.style.width = "50px";
        img.style.height = "50px";
        img.style.objectFit = "cover";
        img.style.borderRadius = "4px";
        recipeEl.appendChild(img);
      }

      const nameSpan = document.createElement("span");
      nameSpan.textContent = recipe.name;
      recipeEl.appendChild(nameSpan);

      recipeEl.onclick = () => showRecipeDetail(section, recipe);

      recipeEl.addEventListener("dragstart", () => {
        draggedRecipe = {
          sectionId: section.id,
          index: section.recipes.indexOf(recipe)
        };
        recipeEl.classList.add("dragging");
      });

      recipeEl.addEventListener("dragend", () => {
        draggedRecipe = null;
        recipeEl.classList.remove("dragging");
      });

      recipeEl.addEventListener("dragover", e => e.preventDefault());

      recipeEl.addEventListener("drop", () => {
        if (!draggedRecipe) return;
        if (draggedRecipe.sectionId !== section.id) return;

        const targetIndex = section.recipes.indexOf(recipe);

        const moved = section.recipes.splice(draggedRecipe.index, 1)[0];
        section.recipes.splice(targetIndex, 0, moved);

        saveData();
        renderCookbook();
      });

      sectionEl.appendChild(recipeEl);
    });

    container.appendChild(sectionEl);
  });

  buildTOC();
}

// --------------------
// Sections
// --------------------
function addSection() {
  const name = prompt("Section name:");
  if (!name) return;

  sections.push({
    id: Date.now().toString(),
    name,
    recipes: []
  });

  saveData();
  renderCookbook();
}

// --------------------
// Views
// --------------------
function hideAllViews() {
  document.getElementById("cookbook-view").classList.add("hidden");
  document.getElementById("recipe-form-view").classList.add("hidden");
  document.getElementById("recipe-detail-view").classList.add("hidden");
}

function hideAddRecipe() {
  hideAllViews();
  document.getElementById("cookbook-view").classList.remove("hidden");
  thinkResetForm();
}

function hideRecipeDetail() {
  hideAllViews();
  document.getElementById("cookbook-view").classList.remove("hidden");
}

// --------------------
// Add Recipe
// --------------------
function showAddRecipe() {
  ensureStarterSection();
  formMode = "add";
  currentRecipe = null;
  currentSection = null;
  tempImage = null;

  document.getElementById("recipe-form-title").textContent = "Add Recipe";
  document.getElementById("recipe-submit-btn").textContent = "Save Recipe";

  hideAllViews();
  document.getElementById("recipe-form-view").classList.remove("hidden");

  populateSectionDropdown();
  document.getElementById("recipe-form").reset();

  const fileInput = document.getElementById("recipe-image");
  const preview = document.getElementById("image-preview");
  const removeBtn = document.getElementById("remove-image-btn");

  fileInput.value = "";

  preview.src = "";
  preview.style.display = "none";
  removeBtn.style.display = "none";

  removeBtn.onclick = () => {
    tempImage = null;
    fileInput.value = "";
    preview.src = "";
    preview.style.display = "none";
    removeBtn.style.display = "none";
  };

  fileInput.onchange = () => updateImagePreview(fileInput, preview, removeBtn);
}

// --------------------
// Recipe Detail
// --------------------
function showRecipeDetail(section, recipe) {
  currentRecipe = recipe;
  currentSection = section;

  hideAllViews();
  document.getElementById("recipe-detail-view").classList.remove("hidden");

  document.getElementById("detail-title").textContent = recipe.name;
  //document.getElementById("detail-section").textContent = section.name;

  const ingredientsList = document.getElementById("detail-ingredients");
  ingredientsList.innerHTML = "";
  recipe.ingredients.forEach(i => {
    const li = document.createElement("li");
    li.textContent = i;
    ingredientsList.appendChild(li);
  });

  const stepsEl = document.getElementById("detail-steps");
  stepsEl.innerHTML = "";
  const stepsList = document.createElement("ol");
  recipe.steps.split("\n").forEach(line => {
    if (line.trim()) {
      const li = document.createElement("li");
      li.textContent = line;
      stepsList.appendChild(li);
    }
  });
  stepsEl.appendChild(stepsList);

  const img = document.getElementById("detail-image");
  if (recipe.image) {
    img.src = recipe.image;
    img.style.display = "block";
  } else {
    img.style.display = "none";
  }

  const oldBtns = document.getElementById("recipe-action-buttons");
  if (oldBtns) oldBtns.remove();

  const btns = document.createElement("div");
  btns.id = "recipe-action-buttons";

  const editBtn = document.createElement("button");
  editBtn.textContent = "Edit";
  editBtn.onclick = () => editRecipe(section, recipe);

  const deleteBtn = document.createElement("button");
  deleteBtn.textContent = "Delete";
  deleteBtn.onclick = () => {
    if (confirm("Delete this recipe?")) {
      section.recipes = section.recipes.filter(r => r !== recipe);
      saveData();
      renderCookbook();
      hideAllViews();
      document.getElementById("cookbook-view").classList.remove("hidden");
    }
  };

  btns.appendChild(editBtn);
  btns.appendChild(deleteBtn);
  document.getElementById("recipe-detail-view").appendChild(btns);
}

// --------------------
// Edit Recipe
// --------------------
function editRecipe(section, recipe) {
  formMode = "edit";
  currentRecipe = recipe;
  currentSection = section;
  tempImage = recipe.image || null;

  document.getElementById("recipe-form-title").textContent = "Edit Recipe";
  document.getElementById("recipe-submit-btn").textContent = "Update Recipe";

  hideAllViews();
  document.getElementById("recipe-form-view").classList.remove("hidden");

  populateSectionDropdown();
  document.getElementById("recipe-section").value = section.id;

  document.getElementById("recipe-name").value = recipe.name;
  document.getElementById("recipe-ingredients").value = recipe.ingredients.join("\n");
  document.getElementById("recipe-steps").value = recipe.steps;

  const fileInput = document.getElementById("recipe-image");
  const preview = document.getElementById("image-preview");
  const removeBtn = document.getElementById("remove-image-btn");

  fileInput.value = "";

  if (tempImage) {
    preview.src = tempImage;
    preview.style.display = "block";
    removeBtn.style.display = "inline-block";
  } else {
    preview.src = "";
    preview.style.display = "none";
    removeBtn.style.display = "none";
  }

  removeBtn.onclick = () => {
    tempImage = null; // only clears temporary image
    fileInput.value = "";
    preview.src = "";
    preview.style.display = "none";
    removeBtn.style.display = "none";
  };

  fileInput.onchange = () => updateImagePreview(fileInput, preview, removeBtn);
}

// --------------------
// Form Submit
// --------------------
document.getElementById("recipe-form").addEventListener("submit", async e => {
  e.preventDefault();

  const name = document.getElementById("recipe-name").value.trim();
  const sectionId = document.getElementById("recipe-section").value;
  const ingredients = document.getElementById("recipe-ingredients").value
    .split("\n").map(i => i.trim()).filter(Boolean);
  const steps = document.getElementById("recipe-steps").value.trim();

  const section = sections.find(s => s.id === sectionId);
  if (!section) return;

  const recipeId = formMode === "edit" ? currentRecipe.id : Date.now().toString();
  const image = tempImage;

  if (formMode === "edit") {
    currentRecipe.name = name;
    currentRecipe.ingredients = ingredients;
    currentRecipe.steps = steps;
    currentRecipe.image = image;

    if (currentSection.id !== section.id) {
      currentSection.recipes = currentSection.recipes.filter(r => r !== currentRecipe);
      section.recipes.push(currentRecipe);
    }
  } else {
    section.recipes.push({
      id: recipeId,
      name,
      ingredients,
      steps,
      image
    });
  }

  try {
    const saved = await saveData();
    if (!saved) return;
    renderCookbook();
    hideAllViews();
    document.getElementById("cookbook-view").classList.remove("hidden");
    thinkResetForm();
    setStatus("Recipe saved.");
  } catch (error) {
    setStatus("Could not save. Try a smaller image or remove older images.");
  }
});


function thinkResetForm() {
  document.getElementById("recipe-form").reset();
  const preview = document.getElementById("image-preview");
  const removeBtn = document.getElementById("remove-image-btn");
  preview.src = "";
  preview.style.display = "none";
  removeBtn.style.display = "none";
  tempImage = null;
}

// --------------------
// Helpers
// --------------------
function populateSectionDropdown() {
  ensureStarterSection();
  const select = document.getElementById("recipe-section");
  select.innerHTML = "";
  sections.forEach(s => {
    const opt = document.createElement("option");
    opt.value = s.id;
    opt.textContent = s.name;
    select.appendChild(opt);
  });
}

// --------------------
// TOC
// --------------------
function buildTOC() {
  const toc = document.getElementById("toc-list");
  toc.innerHTML = "";

  sections.forEach((s, index) => {
    const li = document.createElement("li");
    li.dataset.dragIndex = index;

    const containerDiv = document.createElement("div");
    containerDiv.style.display = "flex";
    containerDiv.style.alignItems = "center";
    containerDiv.style.gap = "8px";
    containerDiv.style.width = "100%";

    // Grip (only visible in edit mode)
    const grip = document.createElement("span");
    grip.textContent = "≡";
    grip.style.cursor = "grab";
    grip.style.fontWeight = "bold";
    grip.style.visibility = tocEditMode ? "visible" : "hidden";

    // Label
    const label = document.createElement("span");
    label.textContent = s.name;
    label.style.flex = "1";

    // Pencil (only visible in edit mode)
    const pencil = document.createElement("button");
    pencil.textContent = "✏️";
    pencil.style.fontSize = "0.8em";
    pencil.style.padding = "2px 4px";
    pencil.style.marginLeft = "auto";
    pencil.style.height = "20px";
    pencil.style.width = "24px";
    pencil.style.lineHeight = "16px";
    pencil.style.border = "none";
    pencil.style.background = "transparent";
    pencil.style.cursor = tocEditMode ? "pointer" : "default";
    pencil.style.visibility = tocEditMode ? "visible" : "hidden";

    pencil.onclick = e => {
      e.stopPropagation();
      const input = document.createElement("input");
      input.type = "text";
      input.value = s.name;
      input.style.width = "70%";

      containerDiv.replaceChild(input, label);
      input.focus();

      input.addEventListener("blur", saveRename);
      input.addEventListener("keydown", ev => {
        if (ev.key === "Enter") saveRename();
      });

      function saveRename() {
        const newName = input.value.trim();
        if (newName) {
          s.name = newName;
          saveData();
          renderCookbook();
          buildTOC();
        } else {
          containerDiv.replaceChild(label, input);
        }
      }
    };

    containerDiv.appendChild(grip);
    containerDiv.appendChild(label);
    containerDiv.appendChild(pencil);
    li.appendChild(containerDiv);

    // Desktop drag only if in edit mode
    li.draggable = tocEditMode;
    li.addEventListener("dragstart", () => li.classList.add("dragging"));
    li.addEventListener("dragend", () => li.classList.remove("dragging"));
    li.addEventListener("dragover", e => e.preventDefault());
    li.addEventListener("drop", () => {
      if (!tocEditMode) return;
      const from = Number(document.querySelector(".dragging")?.dataset.dragIndex);
      const to = index;
      if (from === to) return;

      const moved = sections.splice(from, 1)[0];
      sections.splice(to, 0, moved);

      saveData();
      renderCookbook();
      buildTOC();
    });

    // Mobile touch drag only in edit mode
    li.addEventListener("touchstart", e => {
      if (!tocEditMode) return;
      touchDraggingIndex = index;
      li.classList.add("dragging");
    });

    li.addEventListener("touchmove", e => {
      if (!tocEditMode) return;
      e.preventDefault();
      const touch = e.touches[0];
      const target = document.elementFromPoint(touch.clientX, touch.clientY);
      const overLi = target?.closest("li");

      document.querySelectorAll("#toc-list li").forEach(el => el.classList.remove("drag-over"));

      if (overLi && overLi !== li) {
        overLi.classList.add("drag-over");
      }
    });

    li.addEventListener("touchend", e => {
      if (!tocEditMode) return;
      const touch = e.changedTouches[0];
      const target = document.elementFromPoint(touch.clientX, touch.clientY);
      const overLi = target?.closest("li");

      if (overLi) {
        const to = Number(overLi.dataset.dragIndex);
        const from = touchDraggingIndex;

        if (from !== null && from !== to) {
          const moved = sections.splice(from, 1)[0];
          sections.splice(to, 0, moved);

          saveData();
          renderCookbook();
          buildTOC();
        }
      }

      document.querySelectorAll("#toc-list li").forEach(el => {
        el.classList.remove("dragging", "drag-over");
      });

      touchDraggingIndex = null;
    });

    // Tap to scroll only if not in edit mode
    if (!tocEditMode) {
      li.onclick = () => {
        closeTOC();
        document.getElementById(`section-${s.id}`)?.scrollIntoView({ behavior: "smooth" });
      };
    }

    toc.appendChild(li);
  });
}

const editBtn = document.getElementById("toc-edit-btn");
editBtn.onclick = e => {
  e.stopPropagation();
  tocEditMode = !tocEditMode; // toggle edit mode
  editBtn.textContent = tocEditMode ? "Done" : "Edit"; // update label
  buildTOC(); // re-render TOC so grips/pencils appear
};

function toggleTOC() {
  document.getElementById("toc").classList.toggle("open");
  document.getElementById("overlay").classList.toggle("hidden");
}

function closeTOC() {
  document.getElementById("toc").classList.remove("open");
  document.getElementById("overlay").classList.add("hidden");
}

// --------------------
// Search
// --------------------
document
  .getElementById("recipe-search")
  .addEventListener("input", e => {
    currentSearch = e.target.value.toLowerCase().trim();
    renderCookbook();
  });


function enableAutoScroll(container) {
  container.addEventListener("dragover", e => {
    const rect = container.getBoundingClientRect();
    const offset = 40;

    if (e.clientY < rect.top + offset) {
      container.scrollTop -= 10;
    } else if (e.clientY > rect.bottom - offset) {
      container.scrollTop += 10;
    }
  });
}


// --------------------
// Register Service Worker
// --------------------
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("./service-worker.js")
      .then(reg => console.log("Service Worker registered", reg))
      .catch(err => console.error("Service Worker failed", err));
  });
}

async function initializeApp() {
  try {
    sections = await loadCookbook();
    await migrateLegacyCookbookIfNeeded();
    const createdStarterSection = ensureStarterSection();
    if (createdStarterSection) await saveData();
    cleanupLegacyImageCache();
    renderCookbook();
  } catch (error) {
    console.error(error);
    setStatus("Could not open offline storage. Try refreshing the app.");
    sections = [];
    ensureStarterSection();
    renderCookbook();
  }
}

initializeApp();
