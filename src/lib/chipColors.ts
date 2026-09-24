// One accent per chip - FlashGrid's chip badges and FreeBlockChart's chip
// labels share it so a chip reads as the same thing everywhere. Indexed
// with % so a larger chip count still degrades gracefully.
//
// Chips 0-2: the dataviz reference palette's first three dark-mode
// categorical slots (blue/orange/aqua), which pass every check all-pairs on
// this app's #1c1e26 surface (validate_palette.js: worst CVD ΔE 9.4, worst
// normal-vision ΔE 20.9, all >= 3:1). No fourth hue passes against those
// three (every candidate fell below the CVD/normal-vision floors), so chip
// 3 is a neutral gray - the badge's own chip number is the identity, color
// only helps. The old set (#4dabf7/#b980f0/#ff8ac2/#4ecdc4) failed: chips
// 0 and 1 were ΔE 1.4 apart for deutan viewers.
export const CHIP_COLORS = ['#3987e5', '#d95926', '#199e70', '#aab0c4'];
