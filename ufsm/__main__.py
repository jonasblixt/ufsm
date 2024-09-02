from PySide6 import QtWidgets

import sys

class MainWindow(QtWidgets.QMainWindow):

    def __init__(self):
        super().__init__()

        self.setWindowTitle("Hello World")
        l = QtWidgets.QLabel("My simple app.")
        l.setMargin(10)
        self.setCentralWidget(l)
        self.show()

def main():
    app = QtWidgets.QApplication(sys.argv)
    w = MainWindow()
    app.exec()
