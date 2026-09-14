import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../src/mcp.js';
import { runtimeVersion } from '../src/runtime.js';
test('MCP handshake, runtime identity and manifest share product version with working discovery/read',async()=>{
 const pkg=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
 const server=createMcpServer('/synthetic',{request:async()=>({ready:false})});
 const client=new Client({name:'version-test',version:'1'});const [a,b]=InMemoryTransport.createLinkedPair();
 try{await server.connect(b);await client.connect(a);assert.equal(client.getServerVersion()?.version,pkg.version);
 assert.equal((await runtimeVersion()).packageVersion,pkg.version);assert.equal((await client.listTools()).tools.length,22);
 assert.equal((await client.callTool({name:'connection_status',arguments:{}})).isError,undefined);
 }finally{await client.close();await server.close();}
});
