import { canonicalOrigin, MAX_PROFILES } from '../../shared-types/src/index';

export interface ImportRecord { label:string; url:string; username:string; password:string }
export interface ImportPreview { format:'standard'|'bitwarden'; records:ImportRecord[]; skipped:number; skippedRows:{row:number;reason:string}[] }
const MAX_FILE_CHARS = 2_000_000, MAX_ROWS = 1000, MAX_FIELD = 16_384, MAX_COLUMNS = 80;

/** Strict, bounded RFC-style CSV parsing, including quoted commas, newlines and double quotes. */
function parseCsv(text:string):string[][] {
  if (typeof text !== 'string' || text.length > MAX_FILE_CHARS) throw new Error('CSV must be under 2 MB.');
  if (text.startsWith('\ufeff')) text=text.slice(1);
  const rows:string[][]=[];let row:string[]=[],field='',quoted=false,afterQuote=false;
  const fieldDone=()=>{row.push(field);field='';afterQuote=false;if(row.length>MAX_COLUMNS)throw new Error('CSV has too many columns.');};
  const rowDone=()=>{fieldDone();rows.push(row);row=[];if(rows.length>MAX_ROWS+1)throw new Error('CSV has more than 1,000 rows.');};
  for(let i=0;i<text.length;i++) {
    const c=text[i];
    if(quoted) {
      if(c==='"') {if(text[i+1]==='"'){field+='"';i++;}else{quoted=false;afterQuote=true;}}
      else field+=c;
    } else if(c===',') fieldDone();
    else if(c==='\n' || c==='\r') {if(c==='\r' && text[i+1]==='\n')i++;rowDone();}
    else if(c==='"' && field==='' && !afterQuote) quoted=true;
    else {if(c==='"'||afterQuote)throw new Error('Malformed quoted CSV field.');field+=c;}
    if(field.length>MAX_FIELD)throw new Error('CSV field is too long.');
  }
  if(quoted)throw new Error('Unclosed quoted CSV field.');
  if(field.length || row.length || afterQuote)rowDone();
  return rows;
}

/** Only login name, origin, username and password survive this function. Notes, OTP
 * fields and all other unsupported columns are ignored and never stored. */
export function readLoginCsv(text:string):ImportPreview {
  const rows=parseCsv(text);if(rows.length<2)throw new Error('CSV has no login rows.');
  const header=rows[0].map(v=>v.trim().toLowerCase());
  if(new Set(header).size!==header.length)throw new Error('CSV has duplicate column names.');
  const index=(name:string)=>header.indexOf(name);
  const standard=['url','username','password'].every(h=>index(h)>=0);
  const bitwarden=['login_uri','login_username','login_password'].every(h=>index(h)>=0);
  if(standard===bitwarden)throw new Error('Use a standard name,url,username,password CSV or a Bitwarden login CSV.');
  const format=bitwarden?'bitwarden':'standard';
  const urlIndex=index(bitwarden?'login_uri':'url'), userIndex=index(bitwarden?'login_username':'username'), passIndex=index(bitwarden?'login_password':'password');
  const nameIndex=index('name'), typeIndex=index('type');
  let skipped=0;const skippedRows:{row:number;reason:string}[]=[];const skip=(row:number,reason:string)=>{skipped++;skippedRows.push({row,reason});};const records:ImportRecord[]=[];
  for(let r=1;r<rows.length;r++) {
    const row=rows[r];if(row.every(v=>v===''))continue;
    if(row.length!==header.length)throw new Error(`CSV row ${r+1} has the wrong number of columns.`);
    if(bitwarden && typeIndex>=0 && row[typeIndex].trim().toLowerCase()!=='login'){skip(r+1,'Not a login item');continue;}
    const username=row[userIndex],password=row[passIndex];let origin:string;
    try {origin=canonicalOrigin(row[urlIndex].trim());} catch {skip(r+1,'Unsupported or invalid site URL');continue;}
    const label=(nameIndex>=0?row[nameIndex].trim():'') || new URL(origin).hostname;
    if(!label || label.length>80 || !username || username.length>512 || !password || password.length>4096){skip(r+1,'Missing or oversized login field');continue;}
    records.push({label,url:origin,username,password});
    if(records.length>MAX_PROFILES)throw new Error('CSV has more than 200 supported logins. Split it into smaller files.');
  }
  if(!records.length)throw new Error('No supported logins found. HTTPS URL, username and password are required.');
  return {format,records,skipped,skippedRows};
}
