import React from "react";
import { Drawer } from "../src/ui/index.jsx";
export default function ChartStub({ encounterId, onClose }) { return <Drawer open={!!encounterId} onClose={onClose} title={"Chart " + encounterId}>(chart drawer stub)</Drawer>; }
