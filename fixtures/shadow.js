const open = document
  .getElementById("open-host")
  .attachShadow({ mode: "open" });
open.innerHTML =
  '<section><h2>Inside an open shadow root</h2><img id="shadow-missing-alt" src="data:," width="40" height="40"></section>';

const closed = document
  .getElementById("closed-host")
  .attachShadow({ mode: "closed" });
closed.innerHTML =
  '<section><h2>Inside a closed shadow root</h2><img id="closed-missing-alt" src="data:," width="40" height="40"></section>';
