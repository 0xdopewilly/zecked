// Catches Chrome's install prompt (`beforeinstallprompt`) the moment it fires, which can be before React has
// mounted anything, and parks it on window.__zkInstall for useInstall() (src/lib/install.ts).
// A server-rendered inline script, so it runs while the page is still being parsed. Mounted once, next to
// <SwRegister /> in the app layout.

/** Fired on window whenever the saved prompt or the installed flag changes. */
export const INSTALL_EVENT = "zk:install";
/** localStorage: "1" once ZECKED was installed from this browser (it may have been removed since). */
export const INSTALLED_KEY = "zk:installed";

// preventDefault: no mini-infobar from Chrome; our own buttons call prompt() instead.
const JS = `(function(w){if(w.__zkInstall)return;var s=w.__zkInstall={prompt:null,installed:false};
function ping(){try{w.dispatchEvent(new Event("${INSTALL_EVENT}"))}catch(e){}}
w.addEventListener("beforeinstallprompt",function(e){e.preventDefault();s.prompt=e;ping()});
w.addEventListener("appinstalled",function(){s.prompt=null;s.installed=true;try{localStorage.setItem("${INSTALLED_KEY}","1")}catch(e){}ping()})})(window)`;

export function InstallCapture() {
  return <script dangerouslySetInnerHTML={{ __html: JS }} />;
}
