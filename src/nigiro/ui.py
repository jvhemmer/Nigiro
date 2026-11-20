"""Desktop editor for the first worksheet-to-figure workflow."""

from __future__ import annotations

import csv
import sys
from pathlib import Path

from PyQt6.QtCore import QAbstractTableModel, QModelIndex, Qt
from PyQt6.QtGui import QColor, QCloseEvent, QKeySequence
from PyQt6.QtWidgets import (
    QApplication,
    QColorDialog,
    QComboBox,
    QFileDialog,
    QHBoxLayout,
    QLabel,
    QListWidget,
    QMainWindow,
    QMessageBox,
    QPushButton,
    QSplitter,
    QTableView,
    QTabWidget,
    QVBoxLayout,
    QWidget,
)
from matplotlib.backends.backend_qtagg import FigureCanvasQTAgg
from matplotlib.figure import Figure

from .analysis import run_linear_fit
from .figure_style import FigureStyle
from .plotting import draw_fit
from .project import Correction, FigureAppearance, FigureColor, LinearFit, Plot, PluginStep, Project, Source, Worksheet
from .storage import load_project, save_project


class WorksheetModel(QAbstractTableModel):
    def __init__(self, correct=None):
        super().__init__()
        self.worksheet = Worksheet((), ())
        self.correct = correct

    def set_worksheet(self, worksheet: Worksheet) -> None:
        self.beginResetModel()
        self.worksheet = worksheet
        self.endResetModel()

    def rowCount(self, parent=QModelIndex()):
        return 0 if parent.isValid() else len(self.worksheet.rows)

    def columnCount(self, parent=QModelIndex()):
        return 0 if parent.isValid() else len(self.worksheet.columns)

    def headerData(self, section, orientation, role=Qt.ItemDataRole.DisplayRole):
        if role == Qt.ItemDataRole.DisplayRole:
            if orientation == Qt.Orientation.Horizontal:
                return self.worksheet.columns[section]
            return section + 1
        return None

    def flags(self, index):
        flags = super().flags(index)
        if index.isValid() and self.correct is not None:
            flags |= Qt.ItemFlag.ItemIsEditable
        return flags

    def data(self, index, role=Qt.ItemDataRole.DisplayRole):
        if index.isValid() and role in (Qt.ItemDataRole.DisplayRole, Qt.ItemDataRole.EditRole):
            return self.worksheet.rows[index.row()][index.column()]
        return None

    def setData(self, index, value, role=Qt.ItemDataRole.EditRole):
        if not index.isValid() or role != Qt.ItemDataRole.EditRole or self.correct is None:
            return False
        if value != self.data(index):
            self.worksheet = self.correct(Correction(index.row(), index.column(), value))
            self.dataChanged.emit(index, index)
        return True


class MainWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.project: Project | None = None
        self.path: Path | None = None
        self.dirty = False
        self.result = None
        self.fit_error = ""

        self.raw_model = WorksheetModel()
        self.working_model = WorksheetModel(self.correct_cell)
        worksheets = QTabWidget()
        for model, title in (
            (self.working_model, "Working worksheet"),
            (self.raw_model, "Original CSV"),
        ):
            table = QTableView()
            table.setModel(model)
            worksheets.addTab(table, title)

        self.x_column = QComboBox()
        self.y_column = QComboBox()
        self.fit_button = QPushButton("Run linear fit")
        self.fit_button.clicked.connect(self.fit_line)
        fit_controls = QHBoxLayout()
        for label, column in (("X", self.x_column), ("Y", self.y_column)):
            fit_controls.addWidget(QLabel(label))
            fit_controls.addWidget(column, 1)
        fit_controls.addWidget(self.fit_button)
        self.history = QListWidget()
        self.history.setWordWrap(True)
        left = QWidget()
        layout = QVBoxLayout(left)
        layout.addLayout(fit_controls)
        layout.addWidget(worksheets, 3)
        layout.addWidget(QLabel("Recorded steps"))
        layout.addWidget(self.history, 1)

        self.figure = Figure(layout="constrained")
        self.canvas = FigureCanvasQTAgg(self.figure)
        self.canvas.mpl_connect("button_press_event", self.select_artist)
        self.artists = {}
        self.summary = QLabel()
        self.summary.setWordWrap(True)
        self.element = QComboBox()
        self.element.addItem("Linear fit", "fit")
        self.element.addItem("Observations", "observations")
        self.element.currentIndexChanged.connect(self.update_color_button)
        self.color_button = QPushButton("Change color…")
        self.color_button.clicked.connect(self.change_color)
        figure_controls = QHBoxLayout()
        figure_controls.addWidget(QLabel("Figure element"))
        figure_controls.addWidget(self.element)
        figure_controls.addWidget(self.color_button)
        figure_controls.addStretch()
        right = QWidget()
        layout = QVBoxLayout(right)
        layout.addLayout(figure_controls)
        layout.addWidget(self.canvas, 1)
        layout.addWidget(self.summary)

        splitter = QSplitter()
        splitter.addWidget(left)
        splitter.addWidget(right)
        splitter.setSizes([400, 650])
        self.setCentralWidget(splitter)
        self.resize(1080, 720)

        menu = self.menuBar().addMenu("&File")
        menu.addAction("&Import CSV…", self.import_csv)
        menu.addAction("&Open Project…", QKeySequence.StandardKey.Open, self.open_project)
        self.save_action = menu.addAction(
            "&Save Project", QKeySequence.StandardKey.Save, self.save
        )
        self.save_as_action = menu.addAction("Save Project &As…", lambda: self.save(save_as=True))
        self.export_action = menu.addAction("&Export Figure…", self.export)
        self.refresh()

    def set_project(self, project: Project, path: Path | None) -> None:
        self.project = project
        self.path = path
        self.dirty = path is None
        self.raw_model.set_worksheet(project.source.worksheet)
        self.working_model.set_worksheet(project.worksheet)
        for column in (self.x_column, self.y_column):
            column.clear()
            column.addItems(project.worksheet.columns)
        if project.fit:
            self.x_column.setCurrentIndex(project.fit.x)
            self.y_column.setCurrentIndex(project.fit.y)
        elif self.y_column.count() > 1:
            self.y_column.setCurrentIndex(1)
        self.recompute()

    def refresh(self) -> None:
        project = self.project
        name = (self.path.name if self.path else project.source.name) if project else ""
        self.setWindowTitle(f"Nigiro — {name}[*]" if name else "Nigiro")
        self.setWindowModified(self.dirty)
        self.save_action.setEnabled(project is not None)
        self.save_as_action.setEnabled(project is not None)
        self.fit_button.setEnabled(project is not None and self.x_column.count() >= 2)
        self.export_action.setEnabled(self.result is not None)
        self.element.setEnabled(self.result is not None)
        self.color_button.setEnabled(self.result is not None)

        self.history.clear()
        if project:
            self.history.addItem(f"Import {project.source.name}")
            for operation in project.operations:
                if isinstance(operation, Correction):
                    column = project.worksheet.columns[operation.column]
                    step = f"Correct row {operation.row + 1}, {column}: {operation.value!r}"
                elif isinstance(operation, LinearFit):
                    columns = project.worksheet.columns
                    step = f"Linear fit: {columns[operation.y]} vs {columns[operation.x]}"
                elif isinstance(operation, FigureColor):
                    step = f"Set {operation.element} color to {operation.color}"
                elif isinstance(operation, (FigureStyle, FigureAppearance)):
                    step = "Change figure settings"
                elif isinstance(operation, Plot):
                    step = f"Create {operation.plot_type} plot"
                elif isinstance(operation, PluginStep):
                    step = f"Run {operation.plugin_id} {operation.version}"
                self.history.addItem(step)
            self.history.scrollToBottom()

        x_label = y_label = ""
        if project and project.fit:
            columns = project.worksheet.columns
            x_label, y_label = columns[project.fit.x], columns[project.fit.y]
        self.artists = draw_fit(
            self.figure, self.result, x_label, y_label, project.colors if project else {}
        )
        self.canvas.draw_idle()
        self.update_color_button()
        if self.result is not None:
            fit = self.result
            r_squared = "undefined" if fit.r_squared is None else f"{fit.r_squared:.6g}"
            self.summary.setText(
                f"Slope {fit.slope:.6g} · Intercept {fit.intercept:.6g} · R² {r_squared}"
                f" · n = {len(fit.x)} · Omitted rows {fit.omitted_rows}"
            )
        else:
            self.summary.setText(self.fit_error or "Import a CSV to start an analysis.")

    def recompute(self) -> None:
        self.result = None
        self.fit_error = ""
        if self.project.fit:
            try:
                self.result = run_linear_fit(self.project.worksheet, self.project.fit)
            except ValueError as exc:
                self.fit_error = str(exc)
        self.refresh()

    def correct_cell(self, operation: Correction) -> Worksheet:
        self.project = self.project.apply(operation)
        self.dirty = True
        self.recompute()
        return self.project.worksheet

    def fit_line(self) -> None:
        operation = LinearFit(self.x_column.currentIndex(), self.y_column.currentIndex())
        try:
            result = run_linear_fit(self.project.worksheet, operation)
        except ValueError as exc:
            QMessageBox.warning(self, "Linear fit", str(exc))
            return
        self.project = self.project.apply(operation)
        self.dirty = True
        self.result = result
        self.fit_error = ""
        self.refresh()

    def select_artist(self, event) -> None:
        if event.button != 1 or event.inaxes is None:
            return
        candidates = [
            artist for artist in self.artists
            if artist.axes is event.inaxes and artist.contains(event)[0]
        ]
        if candidates:
            selected = max(candidates, key=lambda artist: artist.get_zorder())
            self.element.setCurrentIndex(self.element.findData(self.artists[selected]))
            if event.dblclick:
                self.change_color()

    def update_color_button(self) -> None:
        label = "Change color…"
        if self.project:
            label = f"{self.project.colors[self.element.currentData()]} · Change color…"
        self.color_button.setText(label)

    def change_color(self) -> None:
        element = self.element.currentData()
        current = self.project.colors[element]
        color = QColorDialog.getColor(QColor(current), self, "Figure element color")
        if color.isValid() and color.name() != current:
            self.project = self.project.apply(FigureColor(element, color.name()))
            self.dirty = True
            self.refresh()

    def import_csv(self) -> None:
        path, _ = QFileDialog.getOpenFileName(self, "Import CSV", "", "CSV (*.csv);;All files (*)")
        if path and self.can_replace_project():
            try:
                file = Path(path)
                project = Project(Source(file.name, file.read_bytes()))
                project.validate()
            except (OSError, ValueError, csv.Error) as exc:
                QMessageBox.warning(self, "Import failed", str(exc))
                return
            self.set_project(project, None)

    def open_project(self) -> None:
        path, _ = QFileDialog.getOpenFileName(self, "Open project", "", "Nigiro (*.nigiro)")
        if path and self.can_replace_project():
            try:
                project = load_project(Path(path))
            except (OSError, ValueError, csv.Error) as exc:
                QMessageBox.warning(self, "Open failed", str(exc))
                return
            self.set_project(project, Path(path))

    def save(self, *, save_as=False) -> bool:
        path = self.path
        if path is None or save_as:
            dialog = QFileDialog(self, "Save project")
            dialog.setAcceptMode(QFileDialog.AcceptMode.AcceptSave)
            dialog.setNameFilter("Nigiro (*.nigiro)")
            dialog.setDefaultSuffix("nigiro")
            dialog.selectFile(self.project.source.name + ".nigiro" if path is None else str(path))
            if not dialog.exec():
                return False
            path = Path(dialog.selectedFiles()[0])
            if path.suffix.lower() != ".nigiro":
                QMessageBox.warning(self, "Save failed", "Choose a filename ending in .nigiro.")
                return False
        try:
            save_project(path, self.project)
        except OSError as exc:
            QMessageBox.warning(self, "Save failed", str(exc))
            return False
        self.path = path
        self.dirty = False
        self.refresh()
        return True

    def export(self) -> None:
        dialog = QFileDialog(self, "Export figure")
        dialog.setAcceptMode(QFileDialog.AcceptMode.AcceptSave)
        dialog.setNameFilters(["SVG (*.svg)", "PDF (*.pdf)"])
        dialog.setDefaultSuffix("svg")
        dialog.filterSelected.connect(
            lambda name: dialog.setDefaultSuffix("pdf" if name.startswith("PDF") else "svg")
        )
        if not dialog.exec():
            return
        path = Path(dialog.selectedFiles()[0])
        if path.suffix.lower() not in (".svg", ".pdf"):
            QMessageBox.warning(self, "Export failed", "Choose a filename ending in .svg or .pdf.")
            return
        try:
            self.figure.savefig(path)
        except (OSError, ValueError) as exc:
            QMessageBox.warning(self, "Export failed", str(exc))

    def can_replace_project(self) -> bool:
        if not self.dirty:
            return True
        buttons = QMessageBox.StandardButton
        answer = QMessageBox.question(
            self, "Unsaved project", "Save changes to the current project?",
            buttons.Save | buttons.Discard | buttons.Cancel, buttons.Save,
        )
        return answer == buttons.Discard or (answer == buttons.Save and self.save())

    def closeEvent(self, event: QCloseEvent) -> None:
        event.setAccepted(self.can_replace_project())


def main() -> int:
    app = QApplication(sys.argv)
    app.setApplicationName("Nigiro")
    window = MainWindow()
    window.show()
    return app.exec()
