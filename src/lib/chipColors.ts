// One accent per chip - ParamPanel currently caps chip count at 4, so 4 is
// enough; indexed with % so a larger chip count still degrades gracefully
// instead of going undefined. FlashGrid's chip badges and FreeBlockChart's
// chip labels share it so a chip reads as the same thing everywhere.
export const CHIP_COLORS = ['#4dabf7', '#b980f0', '#ff8ac2', '#4ecdc4'];
