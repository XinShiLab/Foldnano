// import type { Tool, PointerEvt } from './index';
// import type { ViewContext } from '../core/views';
// import type { EditorMode } from '../core/modes';

// export function PanTool(): Tool {
//   let drag: {x:number;y:number}|null = null;
//   return {
//     name: 'PAN' as const,
//     onPointer(evt: PointerEvt, ctx: ViewContext) {
//       if (evt.type === 'down' && evt.button === 0) { drag = {x:evt.clientX,y:evt.clientY}; return; }
//       if (evt.type === 'move' && drag) {
//         ctx.camera.panBy(evt.clientX - drag.x, evt.clientY - drag.y);
//         drag = {x:evt.clientX,y:evt.clientY};
//       }
//       if (evt.type === 'up' || evt.type === 'cancel') drag = null;
//     }
//   };
// }
