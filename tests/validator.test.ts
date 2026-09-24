import { describe, expect, it } from 'vitest';
import {
  computeGridSlots,
  has180Symmetry,
  isAllWhiteConnected,
  parseGridStringTemplate,
  validateGridTemplate,
} from '../packages/shared/src/index.js';

describe('Grid Template Validator', () => {
  // This fixture is 15x15, so pass its size explicitly (GAME_CONFIG defaults to 12x12).
  const SIZE = 15;
  const sampleValidGrid = [
    '###...###...###',
    '###...###...###',
    '###.........###',
    '....#.....#....',
    '....#.....#....',
    '....#.....#....',
    '....#.....#....',
    '....#.....#....',
    '....#.....#....',
    '....#.....#....',
    '....#.....#....',
    '....#.....#....',
    '###.........###',
    '###...###...###',
    '###...###...###',
  ];

  it('validates 180-degree rotational symmetry correctly', () => {
    const grid = parseGridStringTemplate(sampleValidGrid);
    expect(has180Symmetry(grid, SIZE, SIZE)).toBe(true);

    // Break symmetry
    const asymmetrical = grid.map((row) => [...row]);
    asymmetrical[0][0] = false; // white cell without counterpart at [14][14]
    expect(has180Symmetry(asymmetrical, SIZE, SIZE)).toBe(false);
  });

  it('checks connectivity of all white cells', () => {
    const grid = parseGridStringTemplate(sampleValidGrid);
    expect(isAllWhiteConnected(grid, SIZE, SIZE)).toBe(true);

    // Disconnect top and bottom into two separate components
    const disconnected = grid.map((row) => [...row]);
    disconnected[7] = Array(15).fill(true);
    expect(isAllWhiteConnected(disconnected, SIZE, SIZE)).toBe(false);
  });

  it('enforces minimum entry length of at least 3 letters', () => {
    const grid = parseGridStringTemplate(sampleValidGrid);
    const result = validateGridTemplate(grid, SIZE, SIZE);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);

    // Create a 2-letter across slot
    const shortGrid = grid.map((row) => [...row]);
    shortGrid[3][2] = true; // cuts off 2 letters at (3, 0..1)
    const shortResult = validateGridTemplate(shortGrid, SIZE, SIZE);
    expect(shortResult.valid).toBe(false);
    expect(shortResult.errors.some((e) => e.includes('minimum is 3'))).toBe(true);
  });

  it('computes across and down slots and cell numbering correctly', () => {
    const grid = parseGridStringTemplate(sampleValidGrid);
    const { cellNumbers, acrossSlots, downSlots } = computeGridSlots(grid, SIZE, SIZE);

    expect(cellNumbers[0][3]).toBe(1);
    expect(acrossSlots.length).toBeGreaterThan(15);
    expect(downSlots.length).toBeGreaterThan(15);

    // Slot 1 Across should start at (0, 3) and have length 3
    const slot1Across = acrossSlots.find((s) => s.number === 1);
    expect(slot1Across).toBeDefined();
    expect(slot1Across?.length).toBe(3);
    expect(slot1Across?.cells[0]).toEqual({ row: 0, col: 3 });
  });
});
