// TaskFlow Lite - add, edit, delete, complete, persist tasks.
const taskInput = document.getElementById("task-input");
const addBtn = document.getElementById("add-btn");
const taskList = document.getElementById("task-list");
const errorMsg = document.getElementById("error-msg");
const STORAGE_KEY = "taskflow-lite-tasks";

function saveTasks() {
  const tasks = [];
  taskList.querySelectorAll("li").forEach((li) => {
    tasks.push({
      text: li.querySelector("span").textContent,
      completed: li.querySelector("input[type='checkbox']").checked,
    });
  });
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
}

function createTaskItem(text, completed = false) {
  const li = document.createElement("li");

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = completed;
  if (completed) li.classList.add("completed");
  checkbox.addEventListener("change", () => {
    li.classList.toggle("completed", checkbox.checked);
    saveTasks();
  });

  const span = document.createElement("span");
  span.textContent = text;

  const editBtn = document.createElement("button");
  editBtn.textContent = "Edit";
  editBtn.addEventListener("click", () => {
    const updated = prompt("Edit task:", span.textContent);
    if (updated === null) return;
    if (!updated.trim()) {
      errorMsg.textContent = "Task cannot be empty.";
      return;
    }
    errorMsg.textContent = "";
    span.textContent = updated.trim();
    saveTasks();
  });

  const deleteBtn = document.createElement("button");
  deleteBtn.textContent = "Delete";
  deleteBtn.addEventListener("click", () => {
    li.remove();
    saveTasks();
  });

  li.append(checkbox, span, editBtn, deleteBtn);
  return li;
}

function addTask() {
  const text = taskInput.value.trim();
  if (!text) {
    errorMsg.textContent = "Please enter a task.";
    return;
  }
  errorMsg.textContent = "";
  taskList.appendChild(createTaskItem(text));
  taskInput.value = "";
  saveTasks();
}

function loadTasks() {
  let tasks = [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return;
    tasks = parsed;
  } catch {
    return;
  }
  tasks.forEach((t) => {
    if (typeof t.text !== "string" || !t.text.trim()) return;
    taskList.appendChild(createTaskItem(t.text, t.completed === true));
  });
}

addBtn.addEventListener("click", addTask);
taskInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") addTask();
});

loadTasks();


