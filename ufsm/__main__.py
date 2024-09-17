"""Main module."""

import sys

from PySide6.QtWidgets import (
    QApplication,
    QMainWindow,
    QPushButton,
    QComboBox,
    QGraphicsScene,
    QGraphicsView,
    QGraphicsItem,
    QGroupBox,
    QLabel,
    QLineEdit,
    QFormLayout,
    QHBoxLayout,
    QGraphicsSimpleTextItem
)
from PySide6.QtCore import QRectF, QPointF, Qt
from PySide6.QtGui import QTransform, QPainter, QPainterPath, QBrush, QPen, QFont


class MainWindow(QMainWindow):
    def __init__(self) -> None:
        super().__init__()
        self.setWindowTitle("Hello World")
        l = QLabel("My simple app.")
        l.setMargin(10)
        self.setCentralWidget(l)
        self.show()

class CenterText(QGraphicsItem):
    def __init__(self, text='', parent=None):
        super().__init__(parent)
        self.setFlag(QGraphicsItem.GraphicsItemFlag.ItemIgnoresTransformations | QGraphicsItem.GraphicsItemFlag.ItemIsSelectable)
        self.textItem = QGraphicsSimpleTextItem(text, self)
        self.textItem.setPos(self.textItem.boundingRect().center())

    def setText(self, text):
        self.textItem.setText(text)
        self.textItem.setPos(self.textItem.boundingRect().center())

    def boundingRect(self):
        return self.childrenBoundingRect()

    def paint(self, *args):
        pass

class StateItem(QGraphicsItem):
    font = QFont()
    pen = QPen(Qt.GlobalColor.red, 2)
    def __init__(self, name="State"):
        super(StateItem, self).__init__()
        self.setFlag(
            QGraphicsItem.GraphicsItemFlag.ItemIsMovable
            | QGraphicsItem.GraphicsItemFlag.ItemIsSelectable
        )
        self.name = name
        self.width = 100
        self.height = 100
        label = CenterText(name, self)

    def boundingRect(self):
        return QRectF(0, 0, self.width, self.height)

    def mouseReleaseEvent(self, event):
        super(StateItem, self).mouseReleaseEvent(event)
        last_pos = event.lastScenePos()
        scene = self.scene()

        # TODO: What does 'deciveTransform' mean...
        items = scene.items(last_pos, deviceTransform=self.sceneTransform())
        items.remove(self)

        if len(items) == 0:
            # Seems a bit hackis but just updating with setParentItem does
            # not work.
            scene.removeItem(self)
            scene.addItem(self)
            return

        # TODO: Check if it's the same parent, then bail early.
        item = items.pop() # Get the top most item that's not 'self'
        self.setParentItem(item)
        new_pos = item.mapFromScene(last_pos)
        new_pos -= event.pos()
        self.setPos(new_pos)

    def paint(self, painter, option, widget):
        if self.isSelected():
            color = Qt.GlobalColor.green
        else:
            color = Qt.GlobalColor.gray
        path = QPainterPath()
        path.addRoundedRect(QRectF(0, 0, self.width, self.height), 5, 5);
        painter.fillPath(path, QBrush(color))
        painter.setPen(self.pen)
        painter.drawPath(path)

class TransitionItem(QGraphicsItem):
    source: StateItem
    dest: StateItem
    def __init__(self, source: StateItem, dest: StateItem):
        super(TransitionItem, self).__init__()
        self.source = source
        self.dest = dest
    def paint(self, painter, option, widget):
        path = QPainterPath()

class UfsmView(QGraphicsView):
    def __init__(self, parent):
        super(UfsmView, self).__init__(parent)

        scene = QGraphicsScene()

        a = StateItem("a")
        scene.addItem(a)

        b = StateItem("b")
        b.setParentItem(a)

        c = StateItem("c")
        scene.addItem(c)

        self.setScene(scene)

class MainWindow3(QMainWindow):
    def __init__(self):
        super(MainWindow3, self).__init__()
        self.setWindowTitle("--- UFSM ---")


def main() -> None:
    app = QApplication(sys.argv)
    w = MainWindow3()
    w.resize(800, 600)
    view = UfsmView(w)
    view.resize(800, 600)
    w.show()

    app.exec()

if __name__ == "__main__":
    main()
