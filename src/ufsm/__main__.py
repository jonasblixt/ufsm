"""Main module."""

import logging
import sys

from PySide6.QtWidgets import QApplication

from .gui.main_window import MainWindow

logging.basicConfig(
    level=logging.DEBUG,
    format="%(asctime)s: %(name)s: %(message)s",
    handlers=[
        logging.StreamHandler()
    ]
)

def main() -> None:
    # Initialize the QApplication
    app = QApplication(sys.argv)

    # Set up the main window
    main_window = MainWindow()

    main_window.show()
    sys.exit(app.exec())

if __name__ == "__main__":
    main()
