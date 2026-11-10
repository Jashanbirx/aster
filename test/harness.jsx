// Per-module harness: boots the real data layer (local mode) and renders one module.
import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "../src/styles.css";
import Mod from "@module";
import ChartDrawer from "@chart";
import { boot } from "../src/lib/boot.js";
import { Toasts } from "../src/ui/index.jsx";
import { useUI, closeChart } from "../src/lib/ui-state.js";
function H() {
  const [ok, setOk] = useState(false);
  useEffect(() => { boot(() => {}).then(() => setOk(true)); }, []);
  const ui = useUI();
  if (!ok) return <div className="boot">booting…</div>;
  const full = new URLSearchParams(location.search).get("full");
  return full ? <><Mod /><Toasts /></> : <div className="page" style={{ height: "100vh" }}><div className="page-inner"><Mod /></div><ChartDrawer encounterId={ui.chart} tab={ui.chartTab} onClose={closeChart} /><Toasts /></div>;
}
createRoot(document.getElementById("root")).render(<H />);
