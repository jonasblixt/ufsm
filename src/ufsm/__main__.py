"""Main module."""

import sys

from PySide6.QtWidgets import QApplication

from .gui.main_window import MainWindow


def main() -> None:
    # Initialize the QApplication
    app = QApplication(sys.argv)

    # Set up the main window
    main_window = MainWindow()

    main_window.show()
    sys.exit(app.exec())

if __name__ == "__main__":
    main()
