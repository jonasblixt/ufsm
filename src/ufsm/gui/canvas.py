from __future__ import annotations

from PySide6.QtCore import QPoint, QPointF, Qt
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
    QFrame,
    QGraphicsItem,
    QGraphicsObject,
    QGraphicsRectItem,
    QGraphicsScene,
    QGraphicsSceneMouseEvent,
    QGraphicsSimpleTextItem,
    QGraphicsView,
    QStyleOptionGraphicsItem,
    QWidget,
)

UFSM_GRID_SNAP = 10
SCALE_FACTOR = 1.25

class StateItem(QGraphicsRectItem):
    font = QFont()
    selected_edge = None
    snap_size: int = 10

    def __init__(self, name: str = "State", parent: QWidget | None = None) -> None:
        super().__init__(0, 0, 100, 100, parent)
        self.setFlag(
            QGraphicsItem.GraphicsItemFlag.ItemIsMovable
            | QGraphicsItem.GraphicsItemFlag.ItemIsSelectable
            | QGraphicsItem.GraphicsItemFlag.ItemSendsGeometryChanges
        )
        self.setAcceptHoverEvents(True)
        self.setPen(QPen(QBrush(Qt.red), 5))
        self.name = name

        text_item = QGraphicsSimpleTextItem(name, self)
        text_item.setPos(self.boundingRect().center() - text_item.boundingRect().center())

    def getEdges(self, pos):
        # return a proper Qt.Edges flag that reflects the possible edge(s) at
        # the given position; note that this only works properly as long as the
        # shape() override is consistent and for *pure* rectangle items; if you
        # are using other shapes (like QGraphicsEllipseItem) or items that have
        # a different boundingRect or different implementation of shape(), the
        # result might be unexpected.
        # Finally, a simple edges = 0 could suffice, but considering the new
        # support for Enums in PyQt6, it's usually better to use the empty flag
        # as default value.

        edges = Qt.Edges()
        rect = self.rect()
        border = self.pen().width() / 2

        if pos.x() < rect.x() + border:
            edges |= Qt.LeftEdge
        elif pos.x() > rect.right() - border:
            edges |= Qt.RightEdge
        if pos.y() < rect.y() + border:
            edges |= Qt.TopEdge
        elif pos.y() > rect.bottom() - border:
            edges |= Qt.BottomEdge

        return edges

    def snap(self, value: float) -> float:
        return round(value / self.snap_size) * self.snap_size

    def itemChange(self, change, value):
        if change == QGraphicsItem.ItemPositionChange and not self.selected_edge:
            value.setX(self.snap(value.x()))
            value.setY(self.snap(value.y()))
        return super().itemChange(change, value)

    def mousePressEvent(self, event):
        if event.button() == Qt.LeftButton:
            self.selected_edge = self.getEdges(event.pos())
            self.offset = QPointF()
        else:
            self.selected_edge = Qt.Edges()
        super().mousePressEvent(event)

    def mouseMoveEvent(self, event):
        if self.selected_edge:
            mouse_delta = event.pos() - event.buttonDownPos(Qt.LeftButton)
            rect = self.rect()
            pos_delta = QPointF()
            border = self.pen().width()

            if self.selected_edge & Qt.LeftEdge:
                # ensure that the width is *always* positive, otherwise limit
                # both the delta position and width, based on the border size
                diff = min(mouse_delta.x() - self.offset.x(), rect.width() - border)
                if rect.x() < 0:
                    offset = diff / 2
                    self.offset.setX(self.offset.x() + offset)
                    pos_delta.setX(offset)
                    rect.adjust(offset, 0, -offset, 0)
                else:
                    pos_delta.setX(diff)
                    rect.setWidth(rect.width() - diff)
            elif self.selected_edge & Qt.RightEdge:
                if rect.x() < 0:
                    diff = max(mouse_delta.x() - self.offset.x(), border - rect.width())
                    offset = diff / 2
                    self.offset.setX(self.offset.x() + offset)
                    pos_delta.setX(offset)
                    rect.adjust(-offset, 0, offset, 0)
                else:
                    rect.setWidth(max(border, event.pos().x() - rect.x()))

            if self.selected_edge & Qt.TopEdge:
                # similarly to what done for LeftEdge, but for the height
                diff = min(mouse_delta.y() - self.offset.y(), rect.height() - border)
                if rect.y() < 0:
                    offset = diff / 2
                    self.offset.setY(self.offset.y() + offset)
                    pos_delta.setY(offset)
                    rect.adjust(0, offset, 0, -offset)
                else:
                    pos_delta.setY(diff)
                    rect.setHeight(rect.height() - diff)
            elif self.selected_edge & Qt.BottomEdge:
                if rect.y() < 0:
                    diff = max(mouse_delta.y() - self.offset.y(), border - rect.height())
                    offset = diff / 2
                    self.offset.setY(self.offset.y() + offset)
                    pos_delta.setY(offset)
                    rect.adjust(0, -offset, 0, offset)
                else:
                    rect.setHeight(max(border, event.pos().y() - rect.y()))

            if rect != self.rect():
                self.prepareGeometryChange()
                self.setRect(rect)
                if pos_delta:
                    self.setPos(self.pos() + pos_delta)
        else:
            # use the default implementation for ItemIsMovable
            super().mouseMoveEvent(event)


    def mouseReleaseEvent(self, event: QGraphicsSceneMouseEvent) -> None:
        self.selected_edge = Qt.Edges()
        super().mouseReleaseEvent(event)
        last_pos = event.lastScenePos()
        scene = self.scene()

        # TODO: What does 'deciveTransform' mean...
        items = scene.items( last_pos, order=Qt.AscendingOrder, deviceTransform=self.sceneTransform() )

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

    def hoverMoveEvent(self, event):
        edges = self.getEdges(event.pos())
        if not edges:
            self.unsetCursor()
        elif edges in (Qt.TopEdge | Qt.LeftEdge, Qt.BottomEdge | Qt.RightEdge):
            self.setCursor(Qt.SizeFDiagCursor)
        elif edges in (Qt.BottomEdge | Qt.LeftEdge, Qt.TopEdge | Qt.RightEdge):
            self.setCursor(Qt.SizeBDiagCursor)
        elif edges in (Qt.LeftEdge, Qt.RightEdge):
            self.setCursor(Qt.SizeHorCursor)
        else:
            self.setCursor(Qt.SizeVerCursor)

    def paint( self, painter: QPainter, option: QStyleOptionGraphicsItem, widget: QWidget | None = None) -> None:
        color = Qt.GlobalColor.green if self.isSelected() else Qt.GlobalColor.gray
        path = QPainterPath()
        path.addRoundedRect(self.rect(), 5, 5)
        painter.fillPath(path, QBrush(color))
        painter.setPen(self.pen())
        painter.drawPath(path)

class UfsmScene(QGraphicsScene):
    grid_pen = QPen(QColor(0x3C, 0x38, 0x36))

    def __init__(self, parent: QGraphicsObject) -> None:
        super().__init__(parent)
        bg = QColor(0x28, 0x28, 0x28)
        self.bg_brush = QBrush(bg)
        # self.setSceneRect(QRectF(0, 0, 1000, 1000))

    # Here we can capture mouse press/release and key press/release events
    # and feed into a small state machine for drawing control. We can choose
    # to not send the events further down to "Items" by not calling the
    # super class.
    def mousePressEvent(self, event: QGraphicsSceneMouseEvent) -> None:
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

    def __init__(self, scene: QGraphicsScene, parent: QWidget):
        super().__init__(parent)
        self.setScene(scene)
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
        print(factor)
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