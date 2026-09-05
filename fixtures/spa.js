document.getElementById("navigate").addEventListener("click", () => {
  history.pushState({}, "", "/details");
  document.getElementById("route").textContent = "Route: /details";
  document.getElementById("spa-missing-alt").remove();
});
