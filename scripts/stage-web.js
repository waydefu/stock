import {copyFileSync,lstatSync,mkdirSync,rmSync,realpathSync} from "node:fs";
import {dirname,join,resolve} from "node:path";
import {fileURLToPath} from "node:url";

import {MODULES} from "./module-contract.js";

export const WEB_ASSETS=Object.freeze(["index.html","css/styles.css",...MODULES]);
export function stageWeb(root){
  root=realpathSync(root);
  const output=join(root,"dist");
  for(const path of WEB_ASSETS){
    const source=join(root,path);
    if(!lstatSync(source).isFile()||realpathSync(source)!==source)throw new Error("Invalid web asset: "+path);
  }
  rmSync(output,{recursive:true,force:true});
  for(const path of WEB_ASSETS){
    const target=join(output,path);
    mkdirSync(dirname(target),{recursive:true});
    copyFileSync(join(root,path),target);
  }
  return output;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  stageWeb(fileURLToPath(new URL("..",import.meta.url)));
  console.log("Web distribution staged: "+WEB_ASSETS.length+" allowlisted assets");
}
