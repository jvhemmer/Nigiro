import { useState, type KeyboardEvent } from "react";
import { ChevronLeft, ChevronRight, LockKeyhole } from "lucide-react";

interface WorksheetProps {
  columns: string[];
  rows: string[][];
  originalRows: string[][];
  busy: boolean;
  onCorrect: (row: number, column: number, value: string) => void;
}

const pageSize = 100;

export function Worksheet({ columns, rows, originalRows, busy, onCorrect }: WorksheetProps) {
  const [original, setOriginal] = useState(false);
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState<{ row: number; column: number } | null>(null);
  const start = page * pageSize;
  const visibleRows = (original ? originalRows : rows).slice(start, start + pageSize);

  function editCell(event: KeyboardEvent<HTMLInputElement>, row: number, column: number) {
    if (event.key === "Enter") {
      setEditing(null);
      onCorrect(row, column, event.currentTarget.value);
    } else if (event.key === "Escape") {
      setEditing(null);
    }
  }

  return (
    <section className="worksheet" aria-labelledby="worksheet-heading">
      <div className="section-header">
        <h2 id="worksheet-heading">Worksheet</h2>
        <span className="muted">{rows.length.toLocaleString()} rows</span>
      </div>
      <div className="worksheet-tabs" aria-label="Data views">
        <button aria-pressed={!original} onClick={() => setOriginal(false)}>Working data</button>
        <button aria-pressed={original} onClick={() => setOriginal(true)}>
          <LockKeyhole size={13} /> Original CSV
        </button>
      </div>
      <div className="table-scroll">
        <table aria-label={original ? "Original CSV" : "Working worksheet"}>
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
                        {original ? <span>{value}</span> :
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
                            className={value !== originalRows[rowIndex][column] ? "corrected-cell" : ""}
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
        <span>{original ? "Read-only source data" : "Double-click a cell to edit"}</span>
        {rows.length > pageSize && (
          <div className="page-controls">
            <button
              aria-label="Previous rows" disabled={page === 0}
              onClick={() => setPage(page - 1)}
            ><ChevronLeft size={16} /></button>
            <span>{start + 1}–{start + visibleRows.length}</span>
            <button
              aria-label="Next rows" disabled={start + pageSize >= rows.length}
              onClick={() => setPage(page + 1)}
            ><ChevronRight size={16} /></button>
          </div>
        )}
      </div>
    </section>
  );
}
