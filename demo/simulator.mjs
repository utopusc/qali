// Deterministic training simulator. No hardware or physical safety guarantees.
export class CommandError extends Error {
  constructor(code, message, status=409) { super(message); this.code=code; this.status=status; }
}

export function createSimulator({faultMode=false}={}) {
  let state='idle', guardClosed=true, completedCycles=0, targetCycles=0, speed=0, seq=0;
  const events=[];
  const reject=(code,message,status=409)=>{ throw new CommandError(code,message,status); };
  const snapshot=()=>structuredClone({state,guardClosed,completedCycles,targetCycles,speed,events});
  function command(input) {
    const before=state;
    const type=input && typeof input==='object' && typeof input.type==='string' ? input.type : 'invalid';
    try {
      if(!input || typeof input!=='object' || Array.isArray(input)) reject('INVALID_COMMAND','A command object is required.',422);
      switch(type) {
        case 'start':
          if(!Number.isInteger(input.cycles) || input.cycles<1 || input.cycles>10) reject('INVALID_CYCLES','Cycles must be an integer from 1 to 10.',422);
          if(!Number.isFinite(input.speed) || input.speed<0.1 || input.speed>1) reject('INVALID_SPEED','Speed fraction must be between 0.1 and 1.',422);
          if(state==='running') reject('BUSY','An operation is already running.');
          if(state!=='idle') reject('RESET_REQUIRED','Reset the stopped or completed simulation before starting.');
          if(!guardClosed) reject('GUARD_OPEN','Close the simulated guard before starting.');
          targetCycles=input.cycles; speed=input.speed; completedCycles=0; state='running';
          break;
        case 'step':
          if(state!=='running') reject('NOT_RUNNING','Only a running simulation may advance.');
          completedCycles++;
          if(completedCycles===targetCycles) {
            state='completed';
            // Deliberate, opt-in training defect: loses the final counted cycle.
            if(faultMode) completedCycles--;
          }
          break;
        case 'estop': state='emergency_stopped'; break;
        case 'guard':
          if(typeof input.closed!=='boolean') reject('INVALID_GUARD','Guard state must be a boolean.',422);
          guardClosed=input.closed;
          if(!guardClosed && state==='running') state='fault';
          break;
        case 'reset':
          if(!guardClosed) reject('GUARD_OPEN','Close the simulated guard before resetting.');
          if(state==='running') reject('BUSY','Stop the simulation before resetting.');
          state='idle'; completedCycles=0; targetCycles=0; speed=0;
          break;
        default: reject('UNKNOWN_COMMAND','Unknown simulation command.',422);
      }
      events.push({seq:++seq,type,accepted:true,from:before,to:state});
    } catch(error) {
      events.push({seq:++seq,type,accepted:false,from:before,to:state,code:error.code||'ERROR'});
      throw error;
    } finally {
      if(events.length>500) events.shift();
    }
    return snapshot();
  }
  return {snapshot,command};
}
