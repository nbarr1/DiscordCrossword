import fs from 'fs';
import path from 'path';
import { queryAll, queryOne, runQuery } from '../db/database.js';
import { runMigrations } from '../db/migrations.js';
import { PuzzlePipeline } from '../engine/pipeline.js';

async function main() {
  await runMigrations();

  const args = process.argv.slice(2);
  const command = args[0] || 'help';

  switch (command) {
    case 'generate': {
      let dateStr = new Date().toISOString().split('T')[0];
      let themePrompt: string | undefined;

      for (let i = 1; i < args.length; i++) {
        if (args[i] === '--date' && args[i + 1]) {
          dateStr = args[i + 1];
          i++;
        } else if (args[i] === '--theme' && args[i + 1]) {
          themePrompt = args[i + 1];
          i++;
        }
      }

      // Saving replaces any row for the same date, which would orphan players' attempts on a live puzzle.
      const live = await queryOne<{ id: string; status: string }>(
        `SELECT id, status FROM puzzles WHERE date = ? AND status IN ('published', 'archived');`,
        [dateStr]
      );
      if (live) {
        console.error(`❌ Puzzle ${live.id} for ${dateStr} is already ${live.status}; refusing to replace it.`);
        process.exit(1);
      }

      console.log(`Generating puzzle for date ${dateStr}...`);
      const pipeline = new PuzzlePipeline();
      const puzzle = await pipeline.generatePuzzle(dateStr, { themePrompt });

      if (puzzle) {
        await pipeline.savePuzzleToDatabase(puzzle, 'buffered');
        console.log(`✅ Successfully generated & buffered puzzle: ${puzzle.id} (${puzzle.title})`);
      } else {
        console.error('❌ Failed to generate puzzle.');
      }
      break;
    }

    case 'preview': {
      let puzzleId = args[1];
      let outPath = 'preview.html';

      for (let i = 1; i < args.length; i++) {
        if (args[i] === '--out' && args[i + 1]) {
          outPath = args[i + 1];
          i++;
        } else if (!args[i].startsWith('--')) {
          puzzleId = args[i];
        }
      }

      let puzzleRow;
      if (puzzleId) {
        puzzleRow = await queryOne(`SELECT * FROM puzzles WHERE id = ?;`, [puzzleId]);
      } else {
        puzzleRow = await queryOne(`SELECT * FROM puzzles ORDER BY created_at DESC LIMIT 1;`);
      }

      if (!puzzleRow) {
        console.error('No puzzle found to preview.');
        process.exit(1);
      }

      const grid = JSON.parse(puzzleRow.grid_json);
      const clues = JSON.parse(puzzleRow.clues_json);
      const solution = JSON.parse(puzzleRow.solution_json);

      const html = generatePreviewHtml({
        id: puzzleRow.id,
        title: puzzleRow.title,
        author: puzzleRow.author,
        date: puzzleRow.date,
        theme: puzzleRow.theme,
        grid,
        clues,
        solution,
      });

      fs.writeFileSync(outPath, html, 'utf8');
      console.log(`✅ Generated HTML preview written to: ${path.resolve(outPath)}`);
      break;
    }

    case 'buffer': {
      const puzzles = await queryAll<{ id: string; date: string; title: string; status: string; created_at: string }>(
        `SELECT id, date, title, status, created_at FROM puzzles WHERE status = 'buffered' ORDER BY date ASC;`
      );

      console.log(`\n=== BUFFERED PUZZLES (${puzzles.length}) ===`);
      if (puzzles.length === 0) {
        console.log('No puzzles currently in buffer.');
      } else {
        for (const p of puzzles) {
          console.log(`• ID: ${p.id} | Date: ${p.date} | Title: "${p.title}"`);
        }
      }
      break;
    }

    case 'approve': {
      const id = args[1];
      if (!id) {
        console.error('Usage: cli approve <puzzleId>');
        process.exit(1);
      }
      await runQuery(`UPDATE puzzles SET status = 'published' WHERE id = ?;`, [id]);
      console.log(`✅ Puzzle ${id} marked as published.`);
      break;
    }

    case 'reject': {
      const id = args[1];
      if (!id) {
        console.error('Usage: cli reject <puzzleId>');
        process.exit(1);
      }
      await runQuery(`UPDATE puzzles SET status = 'archived' WHERE id = ?;`, [id]);
      console.log(`🗑️ Puzzle ${id} rejected and archived.`);
      break;
    }

    default:
      console.log(`
Daily Crossword CLI
Commands:
  generate [--date YYYY-MM-DD] [--theme "prompt"]  Generate a new puzzle
  preview [puzzleId] [--out preview.html]         Generate HTML preview
  buffer                                          List buffered puzzles
  approve <puzzleId>                              Approve puzzle for publication
  reject <puzzleId>                               Archive/reject puzzle
`);
  }
}

function generatePreviewHtml(p: any): string {
  const rows = p.solution.map((row: string[], r: number) => {
    const cells = row
      .map((ch: string, c: number) => {
        const isBlack = ch === '#';
        const meta = p.grid?.[r]?.[c];
        const num = meta?.number ? `<span style="position:absolute;top:2px;left:3px;font-size:9px;color:#666;">${meta.number}</span>` : '';
        if (isBlack) {
          return `<td style="width:34px;height:34px;background:#111;border:1px solid #333;"></td>`;
        }
        return `<td style="width:34px;height:34px;position:relative;background:#fff;border:1px solid #444;text-align:center;font-weight:bold;font-size:16px;font-family:sans-serif;color:#000;">
          ${num}${ch}
        </td>`;
      })
      .join('');
    return `<tr>${cells}</tr>`;
  }).join('');

  const acrossClues = p.clues.across
    .map((c: any) => `<li><strong>${c.number}.</strong> ${c.text} <em>[${c.answer}]</em></li>`)
    .join('');

  const downClues = p.clues.down
    .map((c: any) => `<li><strong>${c.number}.</strong> ${c.text} <em>[${c.answer}]</em></li>`)
    .join('');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${p.title} - Preview</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; background: #23272a; color: #f2f3f5; padding: 24px; }
    .container { max-width: 1000px; margin: 0 auto; background: #2c2f33; padding: 24px; border-radius: 12px; }
    table { border-collapse: collapse; margin-bottom: 24px; }
    .clues-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
    ul { list-style: none; padding: 0; }
    li { margin-bottom: 8px; font-size: 14px; line-height: 1.4; }
  </style>
</head>
<body>
  <div class="container">
    <h1>${p.title}</h1>
    <p><strong>Date:</strong> ${p.date} | <strong>Author:</strong> ${p.author} ${p.theme ? `| <strong>Theme:</strong> ${p.theme}` : ''}</p>
    <table>${rows}</table>
    <div class="clues-grid">
      <div>
        <h3>Across</h3>
        <ul>${acrossClues}</ul>
      </div>
      <div>
        <h3>Down</h3>
        <ul>${downClues}</ul>
      </div>
    </div>
  </div>
</body>
</html>`;
}

if (process.argv[1]?.endsWith('cli/index.ts')) {
  main().catch(console.error);
}
