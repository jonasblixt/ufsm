"""Main module."""

from __future__ import annotations

import sys

from PySide6.QtCore import QPoint, QPointF, QRectF, Qt, Signal, Slot
from PySide6.QtGui import (
    QBrush,
    QColor,
    QFont,
    QKeyEvent,
    QPainter,
    QPainterPath,
    QPen,
    QWheelEvent,
)
from PySide6.QtWidgets import (
    QApplication,
    QFrame,
    QGraphicsItem,
    QGraphicsObject,
    QGraphicsScene,
    QGraphicsSceneMouseEvent,
    QGraphicsSimpleTextItem,
    QGraphicsView,
    QMainWindow,
    QStyleOptionGraphicsItem,
    QWidget,
)

UFSM_GRID_SNAP = 10
SCALE_FACTOR = 1.25


class CenterText(QGraphicsItem):
    def __init__(self, text: str = "", parent: QGraphicsItem | None = None):
        super().__init__(parent)
        self.setFlag(
            QGraphicsItem.GraphicsItemFlag.ItemIgnoresTransformations
            | QGraphicsItem.GraphicsItemFlag.ItemIsSelectable
        )
        self.textItem = QGraphicsSimpleTextItem(text, self)
        self.textItem.setPos(parent.boundingRect().center())
        print(f"text, parent rect: {parent.boundingRect()}")

    def setText(self, text: str) -> None:
        self.textItem.setText(text)
        self.textItem.setPos(self.textItem.boundingRect().center())

    def boundingRect(self) -> QRectF:
        return self.childrenBoundingRect()

    def paint(
        self, painter: QPainter, option: QStyleOptionGraphicsItem, widget: QWidget | None = None
    ) -> None:
        pass


class Resizer(QGraphicsObject):
    clr = QBrush(QColor(0xD6, 0x5D, 0x0E))
    resizeSignal = Signal(QPointF)

    def __init__(self, rect=QRectF(0, 0, 10, 10), parent: StateItem = None):
        super().__init__(parent)

        self.setFlag(QGraphicsItem.ItemIsMovable, True)
        self.setFlag(QGraphicsItem.ItemIsSelectable, True)
        self.setFlag(QGraphicsItem.ItemSendsGeometryChanges, True)
        self.rect = rect
        self.parent = parent

    def boundingRect(self):
        return self.rect

    def paint(self, painter, option, widget=None):
        if self.parent.isSelected() or self.isSelected():
            print(f"resizer: {self.rect}")
            painter.fillRect(self.rect, self.clr)

    def itemChange(self, change, value):
        if change == QGraphicsItem.ItemPositionChange:
            value.setX(round(value.x() / 10) * 10)
            value.setY(round(value.y() / 10) * 10)
            # if self.isSelected():
            #    self.resizeSignal.emit(value - self.pos())
        elif change == QGraphicsItem.ItemPositionHasChanged:
            self.parent.boundingRect().setTop(value.y())
        return value


class StateItem(QGraphicsItem):
    font = QFont()
    pen = QPen(Qt.GlobalColor.red, 2)
    resize_clr = QBrush(QColor(0xD6, 0x5D, 0x0E))
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
        # label = CenterText(name, self)

        textItem = QGraphicsSimpleTextItem(name, self)
        textItem.setPos(self.boundingRect().center() -
                        textItem.boundingRect().center())
        print(f"bottom: {self.boundingRect().bottomRight()}")
        self.r = Resizer(parent=self)
        self.r.setPos(self.boundingRect().bottomRight())
        self.r.resizeSignal.connect(self.resize)
        self.r2 = Resizer(parent=self)
        self.r2.setPos(self.boundingRect().topRight() - QPointF(0, 7))
        self.r2.resizeSignal.connect(self.resize2)

    def itemChange(self, change, value):
        if change == QGraphicsItem.ItemPositionChange and self._snap:
            value.setX(round(value.x() / self._snapSize) * self._snapSize)
            value.setY(round(value.y() / self._snapSize) * self._snapSize)
            # HACK: If we don't call update on the scene here we get rendering
            # artifacts when the view is scaled.
            self.scene().update()
        return super().itemChange(change, value)

    def boundingRect(self) -> QRectF:
        return QRectF(0, 0, 100, 100)

    def mouseReleaseEvent(self, event: QGraphicsSceneMouseEvent) -> None:
        super().mouseReleaseEvent(event)
        last_pos = event.lastScenePos()
        scene = self.scene()

        # TODO: What does 'deciveTransform' mean...
        items = scene.items(
            last_pos, order=Qt.AscendingOrder, deviceTransform=self.sceneTransform()
        )

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
        item = items.pop()  # Get the top most item that's not 'self'
        # TODO: Sometimes it drop on the "label"... We should
        # filter out compatible objects
        self.setParentItem(item)
        new_pos = item.mapFromScene(last_pos)
        new_pos -= event.pos()
        self.setPos(new_pos)

    def paint(
        self, painter: QPainter, option: QStyleOptionGraphicsItem, widget: QWidget | None = None
    ) -> None:
        color = Qt.GlobalColor.green if self.isSelected() else Qt.GlobalColor.gray
        path = QPainterPath()
        path.addRoundedRect(QRectF(0, 0, self.width, self.height), 5, 5)
        painter.fillPath(path, QBrush(color))
        painter.setPen(self.pen)
        painter.drawPath(path)

    @Slot()
    def resize(self, change) -> None:
        self.r.setFlag(QGraphicsItem.ItemSendsGeometryChanges, False)
        self.r2.setFlag(QGraphicsItem.ItemSendsGeometryChanges, False)
        self.width += change.x()
        self.height += change.y()
        self.prepareGeometryChange()
        self.scene().update()

        self.r.setPos(self.boundingRect().bottomRight())
        self.r2.setPos(self.boundingRect().topRight() - QPointF(0, 7))
        self.r.setFlag(QGraphicsItem.ItemSendsGeometryChanges, True)
        self.r2.setFlag(QGraphicsItem.ItemSendsGeometryChanges, True)

    @Slot()
    def resize2(self, change):
        self.r.setFlag(QGraphicsItem.ItemSendsGeometryChanges, False)
        self.r2.setFlag(QGraphicsItem.ItemSendsGeometryChanges, False)
        self.width += change.x()
        self.height -= change.y()
        self.setPos(self.pos() + QPointF(0, change.y()))

        print(self.boundingRect())
        print(f"1!! r2 pos {self.r2.pos()} {self.height} {self.pos()}")
        self.r.setPos(self.boundingRect().bottomRight())
        self.r2.setPos(self.pos() - QPointF(0, 7))
        print(f"2!! r2 pos {self.r2.pos()}")

        self.r.setFlag(QGraphicsItem.ItemSendsGeometryChanges, True)
        self.r2.setFlag(QGraphicsItem.ItemSendsGeometryChanges, True)
        self.r2.prepareGeometryChange()
        self.prepareGeometryChange()
        self.scene().update()


class UfsmScene(QGraphicsScene):
    grid_pen = QPen(QColor(0x3C, 0x38, 0x36))

    def __init__(self) -> None:
        super().__init__()
        bg = QColor(0x28, 0x28, 0x28)
        self.bg_brush = QBrush(bg)
        # self.setSceneRect(QRectF(0, 0, 1000, 1000))

    # Here we can capture mouse press/release and key press/release events
    # and feed into a small state machine for drawing control. We can choose
    # to not send the events further down to "Items" by not calling the
    # super class.
    def mousePressEvent(self, event: QGraphicsSceneMouseEvent) -> None:
        last_pos = event.lastScenePos()
        # print(f"UfsmScene lmb {last_pos}")
        super().mousePressEvent(event)

    def keyPressEvent(self, event: QKeyEvent) -> None:
        super().keyPressEvent(event)
        print(f"UfsmScene key {event}")
        if Qt.Key_A == event.key():
            print("A!")
        if Qt.Key_Escape == event.key():
            print("Esc")

    def drawBackground(self, qp, rect):
        qp.fillRect(rect, self.bg_brush)
        qp.translate(0.5, 0.5)
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
    _isScrolling = False

    def __init__(self, parent: QWidget):
        super().__init__(parent)
        self.setTransformationAnchor(QGraphicsView.ViewportAnchor.NoAnchor)
        self.setResizeAnchor(QGraphicsView.ViewportAnchor.NoAnchor)
        self.setVerticalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        self.setHorizontalScrollBarPolicy(
            Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        self.setFrameShape(QFrame.Shape.NoFrame)
        self.setRenderHints(QPainter.Antialiasing |
                            QPainter.SmoothPixmapTransform)
        self.setSceneRect(-32000, -32000, 64000, 64000)

    def wheelEvent(self, event: QWheelEvent):
        factor = SCALE_FACTOR
        if event.angleDelta().y() < 0:
            factor = 1 / SCALE_FACTOR

        view_pos = QPoint(event.position().x(), event.position().y())
        scene_pos = self.mapToScene(view_pos)
        self.scale(factor, factor)
        self.centerOn(scene_pos)
        delta = self.mapToScene(
            view_pos) - self.mapToScene(self.viewport().rect().center())
        self.centerOn(scene_pos - delta)
        event.accept()

    def mousePressEvent(self, event):
        if event.button() == Qt.MouseButton.RightButton:
            self._isScrolling = True
            self.viewport().setCursor(Qt.CursorShape.ClosedHandCursor)
            self.scrollPos = event.position()
        else:
            super().mousePressEvent(event)

    def mouseReleaseEvent(self, event):
        if self._isScrolling:
            self._isScrolling = False
            self.viewport().unsetCursor()
        super().mouseReleaseEvent(event)

    def mouseMoveEvent(self, event):
        if self._isScrolling:
            newPos = event.position()
            delta = newPos - self.scrollPos
            t = self.transform()
            self.translate(delta.x() / t.m11(), delta.y() / t.m22())
            self.scrollPos = newPos
        else:
            super().mouseMoveEvent(event)


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
