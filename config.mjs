import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
export function loadConfig(env=process.env){
 const location=env.SIDEQUEST_CONFIG||path.join(os.homedir(),'.config','dsh-sidequest','config.json');
 const config=fs.existsSync(location)?JSON.parse(fs.readFileSync(location,'utf8')):{};
 const workspace=env.SIDEQUEST_WORKSPACE||config.workspace;
 const codexBin=env.SIDEQUEST_CODEX_BIN||config.codexBin||'codex';
 if(typeof workspace!=='string'||!path.isAbsolute(workspace))throw Error('SideQuest: set an absolute workspace path in '+location);
 const real=fs.realpathSync(workspace);if(!fs.statSync(real).isDirectory())throw Error('SideQuest: workspace must be a directory');
 if(typeof codexBin!=='string'||!codexBin.trim())throw Error('SideQuest: codexBin must name a Codex executable');
 return {workspace:real,codexBin};
}
