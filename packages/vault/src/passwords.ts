/** Local-only password tools. Never log or send a password or its health result. */
export interface GeneratorOptions { length:number; lowercase:boolean; uppercase:boolean; numbers:boolean; symbols:boolean }
const classes = {
  lowercase: 'abcdefghijkmnopqrstuvwxyz',
  uppercase: 'ABCDEFGHJKLMNPQRSTUVWXYZ',
  numbers: '23456789',
  symbols: '!@#$%^&*_-+=',
} as const;

/** Rejection sampling avoids modulo bias in cryptographically random choices. */
function randomIndex(size:number):number {
  if (!Number.isInteger(size) || size < 1 || size > 0x1_0000_0000) throw new Error('Invalid random range.');
  const limit = Math.floor(0x1_0000_0000 / size) * size;
  const word = new Uint32Array(1);
  do { crypto.getRandomValues(word); } while (word[0] >= limit);
  return word[0] % size;
}
/** Generate locally. The user still needs to change the password on the website. */
export function generatePassword(options:GeneratorOptions):string {
  if (!Number.isInteger(options.length) || options.length < 12 || options.length > 128) throw new Error('Choose a length from 12 to 128.');
  const selected = (Object.keys(classes) as (keyof typeof classes)[]).filter(k => options[k] === true).map(k => classes[k]);
  if (!selected.length) throw new Error('Choose at least one character set.');
  const pool = selected.join('');
  const characters = selected.map(set => set[randomIndex(set.length)]);
  while (characters.length < options.length) characters.push(pool[randomIndex(pool.length)]);
  for (let i = characters.length - 1; i > 0; i--) { const j = randomIndex(i + 1); [characters[i], characters[j]] = [characters[j], characters[i]]; }
  return characters.join('');
}

/** Very limited, offline hygiene signal—not a breach check or a strength guarantee. */
export function potentiallyWeak(password:string):boolean {
  const p = password.toLowerCase();
  return password.length < 12 || /^(.)\1+$/u.test(password) || ['password','qwerty','123456','letmein','iloveyou'].some(x => p.includes(x));
}
