import sys

from PySide6 import QtWidgets


class MainWindow(QtWidgets.QMainWindow):
    def __init__(self) -> None:
        super().__init__()
        self.setWindowTitle("Hello World")
        l = QtWidgets.QLabel("My simple app.")
        l.setMargin(10)
        self.setCentralWidget(l)
        self.show()

def main() -> None:
    app = QtWidgets.QApplication(sys.argv)
    w = MainWindow()
    app.exec()

if __name__ == "__main__":
    main()
