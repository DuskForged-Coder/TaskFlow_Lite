// TaskFlow Lite - add, edit, delete tasks.
const taskInput = document.getElementById("task-input");
const addBtn = document.getElementById("add-btn");
const taskList = document.getElementById("task-list");
const errorMsg = document.getElementById("error-msg");

function createTaskItem(text) {
  const li = document.createElement("li");

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.addEventListener("change", () => {
    li.classList.toggle("completed", checkbox.checked);
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
  });

  const deleteBtn = document.createElement("button");
  deleteBtn.textContent = "Delete";
  deleteBtn.addEventListener("click", () => {
    li.remove();
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
}

addBtn.addEventListener("click", addTask);
taskInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") addTask();
});

