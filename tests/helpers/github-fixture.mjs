// Test-only preload: no production endpoint override and no credential access.
import { createHash } from 'node:crypto';
import { appendFileSync } from 'node:fs';
const bytes = Buffer.from('Synthetic MIT fixture\n');
const blob = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
const original = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(String(input));
  if (url.origin !== 'https://api.github.com') return original(input, init);
  if (new Headers(init?.headers).has('authorization')) throw new Error('Fixture must remain anonymous');
  appendFileSync(process.env.AIPOCH_TEST_REQUESTS, url.pathname + '\n');
  const prefix = '/repos/example/research';
  const responses = {
    [prefix]: {id:123,full_name:'example/research',html_url:'https://github.com/example/research',default_branch:'main',license:{spdx_id:'MIT',name:'MIT License'}},
    [prefix+'/commits/'+ 'a'.repeat(40)]: {sha:'a'.repeat(40),commit:{tree:{sha:'b'.repeat(40)}}},
    [prefix+'/git/trees/'+ 'b'.repeat(40)]: {sha:'b'.repeat(40),truncated:false,tree:[{path:'LICENSE',type:'blob',mode:'100644',sha:blob,size:bytes.length}]},
    [prefix+'/git/blobs/'+blob]: {sha:blob,size:bytes.length,encoding:'base64',content:bytes.toString('base64')},
  };
  return new Response(JSON.stringify(responses[url.pathname] ?? {}), {status:responses[url.pathname]?200:404});
};
