// No-op stub for the IWER desktop-emulator packages (iwer / @iwer/devui
// / @iwer/sem). The immersive bundle sets createXRStore({ emulate:false }),
// so @react-three/xr never instantiates any of these at runtime — but
// they'd otherwise inline ~7 MB of synthetic-environment GLBs into xr.js.
// Aliasing them here (via the bundle's package.json `rlx.aliases`) keeps
// the headset bundle lean. To debug WebXR on a desktop without a headset,
// build a variant WITHOUT this alias to get the real emulator back.
export class XRDevice {}
export class DevUI {}
export class SyntheticEnvironmentModule {}
export const metaQuest3 = {} as never
export const metaQuest2 = {} as never
export const metaQuestPro = {} as never
export const oculusQuest1 = {} as never
export default {}
