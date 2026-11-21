import { useState, type KeyboardEvent } from "react";
import { ChevronLeft, ChevronRight, LockKeyhole } from "lucide-react";

interface WorksheetProps {
  columns: string[];
  rows: string[][];
  originalRows?: string[][];
  busy: boolean;
  rowCount: number;
  offset: number;
  onPage: (offset: number) => void;
  onCorrect?: (row: number, column: number, value: string) => void;
}

const pageSize = 100;

export function Worksheet({ columns, rows, originalRows, busy, rowCount, offset, onPage, onCorrect }: WorksheetProps) {
  const [original, setOriginal] = useState(false);
  const [editing, setEditing] = useState<{ row: number; column: number } | null>(null);
  const readOnly = original || !originalRows || !onCorrect;
  const start = offset;
  const visibleRows = original ? originalRows ?? rows : rows;

  function editCell(event: KeyboardEvent<HTMLInputElement>, row: number, column: number) {
    if (event.key === "Enter") {
      setEditing(null);
      onCorrect?.(row, column, event.currentTarget.value);
    } else if (event.key === "Escape") {
      setEditing(null);
    }
  }

  return (
    <div className="worksheet">
      <div className="worksheet-tabs" aria-label="Data views">
        {originalRows && <>
          <button aria-pressed={!original} onClick={() => setOriginal(false)}>Working data</button>
          <button aria-pressed={original} onClick={() => setOriginal(true)}>
            <LockKeyhole size={13} /> Original CSV
          </button>
        </>}
        <span className="worksheet-count muted">{rowCount.toLocaleString()} rows</span>
      </div>
      <div className="table-scroll">
        <table aria-label={!originalRows ? "Analysis output" : original ? "Original CSV" : "Working worksheet"}>
          <thead>
            <tr>
              <th className="row-number" scope="col">#</th>
              {columns.map((column, index) => (
                <th scope="col" key={index}>{column || `Column ${index + 1}`}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row, index) => {
              const rowIndex = start + index;
              return (
                <tr key={rowIndex}>
                  <th scope="row" className="row-number">{rowIndex + 1}</th>
                  {row.map((value, column) => {
                    const label = `Row ${rowIndex + 1}, ${columns[column] || `column ${column + 1}`}`;
                    return (
                      <td key={column}>
                        {readOnly ? <span>{value}</span> :
                         editing?.row === rowIndex && editing.column === column ? (
                          <input
                            aria-label={label}
                            autoFocus
                            defaultValue={value}
                            onFocus={(event) => event.currentTarget.select()}
                            onBlur={() => setEditing(null)}
                            onKeyDown={(event) => editCell(event, rowIndex, column)}
                          />
                        ) : (
                          <button
                            className={value !== originalRows?.[index]?.[column] ? "corrected-cell" : ""}
                            aria-label={`${label}, ${value || "blank"}`}
                            title={value}
                            disabled={busy}
                            onDoubleClick={() => setEditing({ row: rowIndex, column })}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" || event.key === "F2") {
                                event.preventDefault();
                                setEditing({ row: rowIndex, column });
                              }
                            }}
                          >{value}</button>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="worksheet-footer">
        <span>{readOnly ? "Read-only source data" : "Double-click a cell to edit"}</span>
        {rowCount > pageSize && (
          <div className="page-controls">
            <button
              aria-label="Previous rows" disabled={busy || start === 0}
              onClick={() => onPage(Math.max(0, start - pageSize))}
            ><ChevronLeft size={16} /></button>
            <span>{start + 1}–{start + visibleRows.length}</span>
            <button
              aria-label="Next rows" disabled={busy || start + pageSize >= rowCount}
              onClick={() => onPage(start + pageSize)}
            ><ChevronRight size={16} /></button>
          </div>
        )}
      </div>
    </div>
  );
}
