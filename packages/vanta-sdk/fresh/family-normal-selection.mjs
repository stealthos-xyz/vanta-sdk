import {selectEnhancedNotes} from './family-enhanced-plan.mjs';

// Selection is cheap. Never construct a 32-input proof when eight inputs suffice.
export function selectFamilyPrivateSendNotes(inventory, blocked, debit, width) {
 if(width!==undefined)return selectEnhancedNotes(inventory,blocked,debit,width);
 return selectEnhancedNotes(inventory,blocked,debit,8)??selectEnhancedNotes(inventory,blocked,debit,32);
}
