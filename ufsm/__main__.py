"""Main module."""

from __future__ import annotations

import sys

from PySide6.QtCore import QRectF, Qt
from PySide6.QtGui import QBrush, QFont, QKeyEvent, QPainter, QPainterPath, QPen
from PySide6.QtWidgets import (
    QApplication,
    QGraphicsItem,
    QGraphicsScene,
    QGraphicsSceneMouseEvent,
    QGraphicsSimpleTextItem,
    QGraphicsView,
    QMainWindow,
    QStyleOptionGraphicsItem,
    QWidget,
)


class CenterText(QGraphicsItem):
    def __init__(self, text: str = "", parent: QGraphicsItem | None = None):
        super().__init__(parent)
        self.setFlag(QGraphicsItem.GraphicsItemFlag.ItemIgnoresTransformations | QGraphicsItem.GraphicsItemFlag.ItemIsSelectable)
        self.textItem = QGraphicsSimpleTextItem(text, self)
        self.textItem.setPos(self.textItem.boundingRect().center())

    def setText(self, text: str) -> None:
        self.textItem.setText(text)
        self.textItem.setPos(self.textItem.boundingRect().center())

    def boundingRect(self) -> QRectF:
        return self.childrenBoundingRect()

    def paint(self, painter: QPainter, option: QStyleOptionGraphicsItem, widget: QWidget | None = None) -> None:
        pass

class StateItem(QGraphicsItem):
    font = QFont()
    pen = QPen(Qt.GlobalColor.red, 2)
    def __init__(self, name: str = "State", parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.setFlag(
            QGraphicsItem.GraphicsItemFlag.ItemIsMovable
            | QGraphicsItem.GraphicsItemFlag.ItemIsSelectable
            # | QGraphicsItem.GraphicsItemFlag.ItemClipsChildrenToShape
        )
        self.name = name
        self.width = 100
        self.height = 100
        label = CenterText(name, self)

    def boundingRect(self) ->  QRectF:
        return QRectF(0, 0, self.width, self.height)

    def mouseReleaseEvent(self, event: QGraphicsSceneMouseEvent) -> None:
        super().mouseReleaseEvent(event)
        last_pos = event.lastScenePos()
        scene = self.scene()

        # TODO: What does 'deciveTransform' mean...
        items = scene.items(last_pos, order=Qt.AscendingOrder,
                            deviceTransform=self.sceneTransform())
        items.remove(self)

        if len(items) == 0:
            # Seems a bit hackis but just updating with setParentItem does
            # not work.
            scene.removeItem(self)
            scene.addItem(self)
            new_pos = last_pos
            new_pos -= event.pos()
            self.setPos(new_pos)
            return

        # TODO: Check if it's the same parent, then bail early.
        item = items.pop() # Get the top most item that's not 'self'
        print(f"New parent {item.name}")
        self.setParentItem(item)
        new_pos = item.mapFromScene(last_pos)
        new_pos -= event.pos()
        self.setPos(new_pos)

    def mousePressEvent(self, event: QGraphicsSceneMouseEvent) -> None:
        super().mousePressEvent(event)
        last_pos = event.lastScenePos()
        #print(f"StateItem: lmb {last_pos}")

    def paint(self, painter: QPainter, option: QStyleOptionGraphicsItem, widget: QWidget | None = None) -> None:
        if self.isSelected():
            color = Qt.GlobalColor.green
        else:
            color = Qt.GlobalColor.gray
        path = QPainterPath()
        path.addRoundedRect(QRectF(0, 0, self.width, self.height), 5, 5)
        painter.fillPath(path, QBrush(color))
        painter.setPen(self.pen)
        painter.drawPath(path)

class TransitionItem(QGraphicsItem):
    source: StateItem
    dest: StateItem
    def __init__(self, source: StateItem, dest: StateItem) -> None:
        super().__init__()
        self.source = source
        self.dest = dest
    def paint(self, painter: QPainter, option: QStyleOptionGraphicsItem, widget: QWidget | None = None) -> None:
        path = QPainterPath()

class UfsmScene(QGraphicsScene):
    def __init__(self) -> None:
        super().__init__()
    # Here we can capture mouse press/release and key press/release events
    # and feed into a small state machine for drawing control. We can choose
    # to not send the events further down to "Items" by not calling the
    # super class.
    def mousePressEvent(self, event: QGraphicsSceneMouseEvent) -> None:
        last_pos = event.lastScenePos()
        #print(f"UfsmScene lmb {last_pos}")
        super().mousePressEvent(event)
    def keyPressEvent(self, event: QKeyEvent) -> None:
        super().keyPressEvent(event)
        print(f"UfsmScene key {event}")
        if Qt.Key_A == event.key():
            print("A!")
        if Qt.Key_Escape == event.key():
            print("Esc")


def main() -> None:
    app = QApplication(sys.argv)
    w = QMainWindow()
    w.setWindowTitle("--- UFSM ---")
    w.resize(800, 600)

    scene = UfsmScene()
    a = StateItem("a", None)
    scene.addItem(a)
    b = StateItem("b", None)
    b.setParentItem(a)
    c = StateItem("c", None)
    scene.addItem(c)

    view = QGraphicsView(w)
    view.resize(800, 600)
    view.setScene(scene)

    w.show()

    app.exec()

if __name__ == "__main__":
    main()
