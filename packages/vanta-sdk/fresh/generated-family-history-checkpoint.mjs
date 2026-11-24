import p0 from './history-doge.json' with {type:'json'};
import p1 from './history-usd1.json' with {type:'json'};
import p2 from './history-usdc.json' with {type:'json'};
import p3 from './history-ccip-bnm.json' with {type:'json'};
export default Object.freeze({schema:'vanta-family-public-history-checkpoint-v1',networkId:'eip155:6281971',
 generationId:'0x2acecbe256faf24f04b0c5ddd06a40cfa7d832677ce6e476e2eb69fa2321c7e0',
 anchor:Object.freeze({number:9765846,hash:'0x5e28365f40113bd39169e0e08115f8b95ee5cbe7472e04c843edf40568147b23'}),
 pools:Object.freeze({'0xd2e97e1197f4f1a78d125c518deca494237b7362':Object.freeze(p0),'0xed4397660cd48cf26a7fc195272005207b4ef93c':Object.freeze(p1),'0xc9c1a05607ca20cac2bd47503638f6be666f7601':Object.freeze(p2),'0xb57bffb8d02e59558a42cb56541299a6213c076b':Object.freeze(p3)})});
