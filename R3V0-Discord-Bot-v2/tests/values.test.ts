import test from 'node:test';
import assert from 'node:assert/strict';
import { MessageFlags, type APIEmbed, type AutocompleteInteraction, type ChatInputCommandInteraction } from 'discord.js';
import { ValueService, valueFeedSchema, valueEmbed, valueSiteUrl, type ValueFeed, type ValueCard } from '../src/services/values.js';
import { commandDefinitions, publicCommands } from '../src/commands/definitions.js';
import { routeInteraction } from '../src/commands/router.js';
import { fixture, ALICE } from './harness.js';

const settings={enabled:true,siteUrl:'https://values.example',cacheSeconds:30};
function card(id='gummy-bear', name='Gummy Bear', variant: ValueCard['variant']='normal'): ValueCard {
  return {key:`pets/${id}/${variant}`,id,name,category:'pets',rarity:'Exclusive',variant,supportsVariants:false,
    image:`/assets/pets/${id}.png`,value:16500,display:'16.5K',priceStatus:'priced',bestPct:100,eventBadge:null,source:'Gummy Egg',map:null,hatchChance:null,exists:null,dropSources:[]};
}
function feed(items:ValueCard[]=[card()]):ValueFeed {
  return {ok:true,apiVersion:1,revision:'a'.repeat(64),updatedAt:'2026-10-08T11:21:03.503Z',dateSource:'admin',source:'/data/prices.js',total:items.length,items};
}
function json(data:unknown):Response {return Response.json(data);}
function service(data=feed()) {return new ValueService(settings,async()=>json(data));}
function command(f:ReturnType<typeof fixture>, name='gummy-bear', variant='normal', category='pets') {
  return Object.assign(f.interaction(ALICE), {commandName:'value',options:{getString:(key:string)=>({name,variant,category}[key])},
    isAutocomplete:()=>false,isChatInputCommand:()=>true,isRepliable:()=>true}) as unknown as ChatInputCommandInteraction;
}
function replies(i:ChatInputCommandInteraction) {return (i as unknown as {replies:{embeds:{toJSON():APIEmbed}[]}[];acknowledgements:{flags?:number}[]});}

test('value command is public, bounded, has autocomplete and optional variants/categories',()=>{
  const definition=commandDefinitions.find(command=>command.name==='value')!.toJSON();
  assert.ok(publicCommands.has('value')); assert.equal(definition.default_member_permissions,null);
  const option=definition.options![0];assert.equal(option.name,'name');assert.ok('autocomplete' in option && option.autocomplete);assert.ok('required' in option && option.required);
  assert.equal(definition.options!.length,3);
});
test('ordinary members receive a public value embed through the actual interaction router',async()=>{
  const f=fixture();f.ctx.values=service();const i=command(f);await routeInteraction(f.ctx,i);
  const result=replies(i);assert.equal(result.acknowledgements[0].flags,undefined);
  const embed=result.replies[0].embeds[0].toJSON();assert.equal(embed.title,'Gummy Bear');assert.match(embed.description!,/16.5K/);
  assert.equal(embed.thumbnail!.url,'https://values.example/assets/pets/gummy-bear.png');assert.equal(embed.color,0xa66bff);f.ctx.db.close();
});
test('zero, O/C and missing price are shown honestly in embeds',()=>{
  for(const [value,display,priceStatus] of [[0,'0','priced'],[null,'O/C','owner_choice'],[null,'Not Price','unpriced']] as const) {
    const item={...card(),value,display,priceStatus};assert.match(valueEmbed(item,feed([item]),new URL(settings.siteUrl)).toJSON().description!,new RegExp(display));
  }
});
test('Golden lookup chooses the Golden price and artwork and supports typed names',async()=>{
  const normal={...card('sunken-eel','Sunken Eel'),supportsVariants:true};
  const golden={...normal,key:'pets/sunken-eel/golden',variant:'golden' as const,value:25,display:'25',image:'/assets/pets/sunken-eel-golden.png'};
  const f=fixture();f.ctx.values=service(feed([normal,golden]));const i=command(f,'SuNKen EEL','golden');await routeInteraction(f.ctx,i);
  const embed=replies(i).replies[0].embeds[0].toJSON();assert.equal(embed.title,'Sunken Eel · Golden');assert.match(embed.description!,/25/);assert.ok(embed.thumbnail!.url.endsWith('sunken-eel-golden.png'));f.ctx.db.close();
});
test('unknown names and unsupported variants produce a useful response rather than another price',async()=>{
  const f=fixture();f.ctx.values=service();
  for(const [name,variant,expected] of [['gummy','normal',/suggestion/],['gummy-bear','golden',/no Golden/]] as const) {
    const i=command(f,name,variant);await routeInteraction(f.ctx,i);const embed=replies(i).replies[0].embeds[0].toJSON();
    assert.equal(embed.title,'Action Unavailable');assert.match(embed.description!,expected);
  }
  f.ctx.db.close();
});
test('autocomplete is available without staff roles and returns at most 25 unique names',async()=>{
  const f=fixture();f.ctx.values=service(feed(Array.from({length:35},(_,i)=>card(`pet-${i}`,`Pet ${i}`))));
  let suggestions:{name:string;value:string}[]=[];
  const i=Object.assign(f.interaction(ALICE),{commandName:'value',options:{getFocused:()=> 'pet',getString:()=>null},isAutocomplete:()=>true,
    respond:async(items:{name:string;value:string}[])=>{suggestions=items;}}) as unknown as AutocompleteInteraction;
  await routeInteraction(f.ctx,i);assert.equal(suggestions.length,25);assert.equal(new Set(suggestions.map(item=>item.value)).size,25);f.ctx.db.close();
});
test('autocomplete does not list duplicate Golden/Diamond cards',async()=>{
  const normal={...card(),supportsVariants:true};const golden={...normal,variant:'golden' as const,key:'pets/gummy-bear/golden'};
  let suggestions:unknown[]=[];
  await service(feed([normal,golden])).autocomplete({options:{getFocused:()=> 'gummy',getString:()=>null},respond:async(items:unknown[])=>{suggestions=items;}} as unknown as AutocompleteInteraction);
  assert.equal(suggestions.length,1);
});
test('command execution refreshes an old autocomplete price instead of displaying it',async()=>{
  let price=16500,requests=0;const client=new ValueService(settings,async()=>{requests++;return json(feed([{...card(),value:price,display:price===16500?'16.5K':'17K'}]));});
  await client.get();price=17000;const f=fixture();f.ctx.values=client;const i=command(f);await routeInteraction(f.ctx,i);
  assert.equal(requests,2);assert.match(replies(i).replies[0].embeds[0].toJSON().description!,/17K/);f.ctx.db.close();
});
test('concurrent requests share one feed read and only validated data enters the cache',async()=>{
  let requests=0;const client=new ValueService(settings,async()=>{requests++;await new Promise(resolve=>setImmediate(resolve));return json(feed());});
  const [a,b]=await Promise.all([client.get(),client.get()]);assert.strictEqual(a,b);assert.equal(requests,1);
  assert.equal((await client.get()).items[0].value,16500);assert.equal(requests,1);
});
test('Pages Functions disabled falls back to the generated static JSON feed',async()=>{
  const paths:string[]=[];const client=new ValueService(settings,async input=>{const path=new URL(String(input)).pathname;paths.push(path);
    return path.endsWith('.json')?json(feed()):new Response('',{status:404});});
  assert.equal((await client.get()).items[0].display,'16.5K');assert.deepEqual(paths,['/api/v1/values','/api/v1/values.json']);
});
test('source failures are not hidden by stale cached prices or a static fallback',async()=>{
  let unavailable=false;const paths:string[]=[];const client=new ValueService(settings,async input=>{paths.push(new URL(String(input)).pathname);return unavailable?new Response('',{status:503}):json(feed());});
  await client.get();unavailable=true;await assert.rejects(client.get(true),/temporarily unavailable/);assert.equal(paths.filter(path=>path.endsWith('.json')).length,0);
});
test('removed selected IDs are rejected even after a successful earlier lookup',async()=>{
  let data=feed();const client=new ValueService(settings,async()=>json(data));await client.get();data=feed([]);
  const f=fixture();f.ctx.values=client;const i=command(f);await routeInteraction(f.ctx,i);
  assert.match(replies(i).replies[0].embeds[0].toJSON().description!,/No matching card/);f.ctx.db.close();
});
test('API failures produce an actionable router response and retain no fabricated price',async()=>{
  const f=fixture();f.ctx.values=new ValueService(settings,async()=>new Response('',{status:503}));const i=command(f);await routeInteraction(f.ctx,i);
  assert.match(replies(i).replies[0].embeds[0].toJSON().description!,/value API is temporarily unavailable/);assert.notEqual(replies(i).acknowledgements[0].flags,MessageFlags.Ephemeral);f.ctx.db.close();
});
test('invalid payloads, duplicate keys, unsafe images and redirects are refused',async()=>{
  for(const data of [{...feed(),apiVersion:2},feed([card(),card()]),feed([{...card(),image:'https://evil.example/pet.png'}]),feed([{...card(),value:null}])]) {
    assert.equal(valueFeedSchema.safeParse(data).success,false);await assert.rejects(new ValueService(settings,async()=>json(data)).get(),/unavailable/);
  }
  await assert.rejects(new ValueService(settings,async()=>new Response('',{status:302,headers:{location:'https://evil.example'}})).get(),/unavailable/);
});
test('missing author date never turns the lookup time into a price-update timestamp',()=>{
  const data={...feed(),updatedAt:null,dateSource:null};const embed=valueEmbed(card(),data,new URL(settings.siteUrl)).toJSON();
  assert.equal(embed.timestamp,undefined);assert.match(embed.footer!.text,/unavailable/);
});
test('Unicode and spaces in artwork URLs remain encoded and same-origin',()=>{
  const item={...card(),image:'/assets/pets/Z%C5%82oty%20Kot.png'};const embed=valueEmbed(item,feed([item]),new URL(settings.siteUrl)).toJSON();
  assert.equal(embed.thumbnail!.url,'https://values.example/assets/pets/Z%C5%82oty%20Kot.png');
  assert.throws(()=>valueSiteUrl('https://user:secret@values.example'));
  assert.throws(()=>valueSiteUrl('http://values.example'));assert.throws(()=>valueSiteUrl('https://values.example/api'));
});
