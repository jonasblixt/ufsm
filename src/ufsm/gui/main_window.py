from PySide6.QtWidgets import QMainWindow, QVBoxLayout, QWidget

from .canvas import StateItem, UfsmScene, UfsmView


class MainWindow(QMainWindow):
    def __init__(self) -> None:
        super().__init__()

        # Set window properties
        self.setWindowTitle("uFSM editor")

        self.scene = UfsmScene(self)
        self.view = UfsmView(self.scene, self)

        a = StateItem("A State", None)
        self.scene.addItem(a)
        b = StateItem("B State", None)
        self.scene.addItem(b)
        c = StateItem("C State", None)
        self.scene.addItem(c)

        # Create a QWidget for the central widget
        central_widget = QWidget(self)
        self.setCentralWidget(central_widget)

        # Set up the layout and add the QGraphicsView to the layout
        layout = QVBoxLayout(central_widget)
        layout.addWidget(self.view)

