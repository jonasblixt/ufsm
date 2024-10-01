"""Main module."""

from __future__ import annotations

import sys
from PySide6.QtCore import QRectF, Qt, QMimeData
from PySide6.QtGui import QBrush, QFont, QKeyEvent, QPainter, QPainterPath, QPen, QDrag
from PySide6.QtWidgets import (
    QApplication,
    QGraphicsItem,
    QGraphicsObject,
    QGraphicsScene,
    QGraphicsSceneMouseEvent,
    QGraphicsSceneDragDropEvent,
    QGraphicsSimpleTextItem,
    QGraphicsView,
    QMainWindow,
    QStyleOptionGraphicsItem,
    QWidget,
    QFrame,
)

UFSM_GRID_SNAP = 10
SCALE_FACTOR = 1.25

class CenterText(QGraphicsItem):
    def __init__(self, text: str = "", parent: QGraphicsItem | None = None):
        super().__init__(parent)
        self.setFlag(QGraphicsItem.GraphicsItemFlag.ItemIgnoresTransformations | QGraphicsItem.GraphicsItemFlag.ItemIsSelectable)
        self.textItem = QGraphicsSimpleTextItem(text, self)
        self.textItem.setPos(parent.boundingRect().center())
        print(f"text, parent rect: {parent.boundingRect()}")

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
    _snap = True
    _snapSize = 10
    def __init__(self, name: str = "State", parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.setFlag(
            QGraphicsItem.GraphicsItemFlag.ItemIsMovable
            | QGraphicsItem.GraphicsItemFlag.ItemIsSelectable
            # | QGraphicsItem.GraphicsItemFlag.ItemClipsChildrenToShape
            | QGraphicsItem.GraphicsItemFlag.ItemSendsGeometryChanges
        )
        self.name = name
        self.width = 100
        self.height = 100
        #label = CenterText(name, self)

        textItem = QGraphicsSimpleTextItem("A State", self)
        print(f"textItem: {textItem.boundingRect()}")
        textItem.setPos(self.boundingRect().center() - textItem.boundingRect().center())

    def itemChange(self, change, value):
        #print(change)
        if change == QGraphicsItem.ItemPositionChange and self._snap:
            value.setX(round(value.x() / self._snapSize) * self._snapSize)
            value.setY(round(value.y() / self._snapSize) * self._snapSize)
        return super().itemChange(change, value)

    def boundingRect(self) ->  QRectF:
        return QRectF(0, 0, self.width, self.height)
    def mouseReleaseEvent(self, event: QGraphicsSceneMouseEvent) -> None:
        super().mouseReleaseEvent(event)
        last_pos = event.lastScenePos()
        scene = self.scene()

        # TODO: What does 'deciveTransform' mean...
        items = scene.items(last_pos, order=Qt.AscendingOrder,
                            deviceTransform=self.sceneTransform())

        # Filter out items we can actually have as a parent
        items = [x for x in items if isinstance(x, StateItem)]

        try:
            items.remove(self)
        except ValueError:
            # TODO: We should not get here, what should we do?
            print("Something bad happened")
            items = []

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
        # TODO: Sometimes it drop on the "label"... We should
        # filter out compatible objects
        self.setParentItem(item)
        new_pos = item.mapFromScene(last_pos)
        new_pos -= event.pos()
        self.setPos(new_pos)

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

class UfsmScene(QGraphicsScene):
    grid_pen = QPen(Qt.lightGray)
    def __init__(self) -> None:
        super().__init__()
        #self.setSceneRect(QRectF(0, 0, 1000, 1000))
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
    def drawBackground(self, qp, rect):
        qp.translate(.5, .5)
        qp.setPen(self.grid_pen)

        x, y, right, bottom = rect.toRect().getCoords()
        top = y
        left = x
        step = UFSM_GRID_SNAP

        yrest = y % step
        if yrest:
            y += step - yrest
        for y in range(y, bottom, step):
            qp.drawLine(left, y, right, y)

        xrest = x % step
        if xrest:
            x += step - xrest
        for x in range(x, right, step):
            qp.drawLine(x, top, x, bottom)

class UfsmView(QGraphicsView):
    _zoom = 0
    def __init__(self, parent: QWidget):
        super().__init__(parent)
        self.setTransformationAnchor(QGraphicsView.ViewportAnchor.AnchorUnderMouse)
        self.setResizeAnchor(QGraphicsView.ViewportAnchor.AnchorUnderMouse)
        self.setVerticalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        self.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        self.setFrameShape(QFrame.Shape.NoFrame)
        self.setAlignment(Qt.AlignLeft | Qt.AlignTop)

        print(self.sceneRect())
    def zoom(self, step):
        zoom = max(0, self._zoom + (step := round(step)))
        if zoom != self._zoom:
            self._zoom = zoom
            if self._zoom > 0:
                if step > 0:
                    factor = SCALE_FACTOR ** step
                else:
                    factor = 1 / SCALE_FACTOR ** abs(step)
                self.scale(factor, factor)
                print(factor)
            else:
                self._zoom = 0
                self.scale(1/SCALE_FACTOR, 1/SCALE_FACTOR)
    def resizeEvent(self, event):
        super().resizeEvent(event)
        self._zoom = 0
    def wheelEvent(self, event):
        delta = event.angleDelta().y()
        self.zoom(delta and delta // abs(delta))

def main() -> None:
    app = QApplication(sys.argv)
    w = QMainWindow()
    w.setWindowTitle("--- UFSM ---")
    w.resize(800, 600)

    scene = UfsmScene()
    a = StateItem("A State", None)
    scene.addItem(a)
    b = StateItem("B State", None)
    scene.addItem(b)
    c = StateItem("C State", None)
    scene.addItem(c)

    view = UfsmView(w)
    view.resize(800, 600)
    view.setScene(scene)

    w.show()

    app.exec()

if __name__ == "__main__":
    main()
