document.getElementById("replace").addEventListener("click", () => {
  const slot = document.getElementById("slot");
  slot.textContent = "";
  const replacement = document.createElement("img");
  // Same id and selector, different element: a stale locator must not match it.
  replacement.id = "target";
  replacement.src = "data:,";
  replacement.width = 120;
  replacement.height = 90;
  slot.append(replacement);
});
