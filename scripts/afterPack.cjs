// Ad-hoc code-sign the macOS app after packing. Apple Silicon refuses to run
// an unsigned binary ("… is damaged … move it to the Trash"). Real signing +
// notarization needs a paid Apple Developer account; ad-hoc signing at least
// makes the app launchable — after download you clear quarantine with
// `xattr -cr <app>` or right-click → Open. No-op on non-macOS builds.
const { execFileSync } = require("node:child_process");
const path = require("node:path");

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return;
  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(context.appOutDir, `${appName}.app`);
  console.log(`  • ad-hoc signing ${appPath}`);
  // --deep signs nested helpers/frameworks; "-" is the ad-hoc identity.
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", appPath], {
    stdio: "inherit",
  });
};
