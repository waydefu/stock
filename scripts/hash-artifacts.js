import {createHash} from "node:crypto";
import {readFileSync,readdirSync,writeFileSync,lstatSync} from "node:fs";
import {join,resolve} from "node:path";
const dir=resolve(process.argv[2]??"native-artifacts");
const files=readdirSync(dir).filter(n=>/\.(exe|apk)$/i.test(n)).sort();
if(!files.length)throw new Error("No native package found");
const hashes=files.map(n=>{
  const f=join(dir,n);if(!lstatSync(f).isFile())throw new Error("Not a regular artifact: "+n);
  return createHash("sha256").update(readFileSync(f)).digest("hex")+"  "+n;
});
writeFileSync(join(dir,"SHA256SUMS.txt"),hashes.join("\n")+"\n");
console.log(hashes.join("\n"));
