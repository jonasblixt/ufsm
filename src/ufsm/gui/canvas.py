from __future__ import annotations

import logging
from typing import Any

from PySide6.QtCore import QObject, QPoint, QPointF, QRect, QRectF, Qt
from PySide6.QtGui import (
    QBrush,
    QColor,
    QFont,
    QKeyEvent,
    QMouseEvent,
    QPainter,
    QPainterPath,
    QPen,
    QWheelEvent,
)
from PySide6.QtWidgets import (
    QFrame,
    QGraphicsItem,
    QGraphicsRectItem,
    QGraphicsScene,
    QGraphicsSceneHoverEvent,
    QGraphicsSceneMouseEvent,
    QGraphicsSimpleTextItem,
    QGraphicsView,
    QStyleOptionGraphicsItem,
    QWidget,
)

# TODO: Adjust grid depending on zoom level
# TODO: Clamp zoom levels to a min/max

LOGGER = logging.getLogger(__name__)
UFSM_GRID_SNAP = 10
SCALE_FACTOR = 1.25

class StateItem(QGraphicsRectItem):
    font = QFont()
    selected_edge = None
    snap_size: int = 10
    is_moving: bool = False

    def __init__(self, name: str = "State", parent: QGraphicsItem | None = None) -> None:
        super().__init__(0, 0, 100, 100, parent)
        self.setFlag(
            QGraphicsItem.GraphicsItemFlag.ItemIsMovable
            | QGraphicsItem.GraphicsItemFlag.ItemIsSelectable
            | QGraphicsItem.GraphicsItemFlag.ItemSendsGeometryChanges
        )
        self.setAcceptHoverEvents(True)
        self.setPen(QPen(QBrush(Qt.GlobalColor.red), 3))
        self.name = name

        text_item = QGraphicsSimpleTextItem(name, self)
        text_item.setPos(self.boundingRect().center() - text_item.boundingRect().center())

    def get_edges(self, pos: QPointF) -> Qt.Edge:
        # return a proper Qt.Edges flag that reflects the possible edge(s) at
        # the given position; note that this only works properly as long as the
        # shape() override is consistent and for *pure* rectangle items; if you
        # are using other shapes (like QGraphicsEllipseItem) or items that have
        # a different boundingRect or different implementation of shape(), the
        # result might be unexpected.
        # Finally, a simple edges = 0 could suffice, but considering the new
        # support for Enums in PyQt6, it's usually better to use the empty flag
        # as default value.
        edges = Qt.Edges() # type: ignore  # noqa: PGH003
        rect = self.rect()
        border = self.pen().width() / 2 + 5

        if pos.x() < rect.x() + border:
            edges |= Qt.Edge.LeftEdge
        elif pos.x() > rect.right() - border:
            edges |= Qt.Edge.RightEdge
        if pos.y() < rect.y() + border:
            edges |= Qt.Edge.TopEdge
        elif pos.y() > rect.bottom() - border:
            edges |= Qt.Edge.BottomEdge

        return edges

    def snap(self, value: float) -> float:
        return round(value / self.snap_size) * self.snap_size

    def itemChange(self, change: QGraphicsItem.GraphicsItemChange, value: Any) -> Any:  # noqa: ANN401
        if change == QGraphicsItem.GraphicsItemChange.ItemPositionChange and not self.selected_edge:
            value.setX(self.snap(value.x()))
            value.setY(self.snap(value.y()))
        return super().itemChange(change, value)

    def mousePressEvent(self, event: QGraphicsSceneMouseEvent) -> None:
        if event.button() == Qt.MouseButton.LeftButton:
            self.selected_edge = self.get_edges(event.pos())
            self.offset = QPointF()
        else:
            self.selected_edge = Qt.Edges() # type: ignore  # noqa: PGH003
        super().mousePressEvent(event)

    def mouseMoveEvent(self, event: QGraphicsSceneMouseEvent) -> None:  # noqa: C901, PLR0912
        if self.isSelected() and not self.is_moving:
            self.is_moving = True
            # Make sure we draw object's that are being moved in the foreground.
            self.saved_z_value = self.zValue()
            self.setZValue(self.saved_z_value + 1000.0)
            LOGGER.debug(f"Moving {self.name}, Z={self.saved_z_value + 1000.0}")
            #LOGGER.debug("Moving selected item")

        if self.selected_edge:
            mouse_delta = event.pos() - event.buttonDownPos(Qt.MouseButton.LeftButton)
            rect = self.rect()
            pos_delta = QPointF()
            border = self.pen().width()

            if self.selected_edge & Qt.Edge.LeftEdge:
                # ensure that the width is *always* positive, otherwise limit
                # both the delta position and width, based on the border size
                diff = min(mouse_delta.x() - self.offset.x(), rect.width() - border)
                diff = self.snap(diff)
                if rect.x() < 0:
                    offset = diff / 2
                    self.offset.setX(self.offset.x() + offset)
                    pos_delta.setX(offset)
                    rect.adjust(offset, 0, -offset, 0)
                else:
                    pos_delta.setX(diff)
                    rect.setWidth(rect.width() - diff)
            elif self.selected_edge & Qt.Edge.RightEdge:
                if rect.x() < 0:
                    diff = max(mouse_delta.x() - self.offset.x(), border - rect.width())
                    diff = self.snap(diff)
                    offset = diff / 2
                    self.offset.setX(self.offset.x() + offset)
                    pos_delta.setX(offset)
                    rect.adjust(-offset, 0, offset, 0)
                else:
                    rect.setWidth(self.snap(max(border, event.pos().x() - rect.x())))

            if self.selected_edge & Qt.Edge.TopEdge:
                # similarly to what done for LeftEdge, but for the height
                diff = min(mouse_delta.y() - self.offset.y(), rect.height() - border)
                diff = self.snap(diff)
                if rect.y() < 0:
                    offset = diff / 2
                    self.offset.setY(self.offset.y() + offset)
                    pos_delta.setY(offset)
                    rect.adjust(0, offset, 0, -offset)
                else:
                    pos_delta.setY(diff)
                    rect.setHeight(rect.height() - diff)
            elif self.selected_edge & Qt.Edge.BottomEdge:
                if rect.y() < 0:
                    diff = max(mouse_delta.y() - self.offset.y(), border - rect.height())
                    diff = self.snap(diff)
                    offset = diff / 2
                    self.offset.setY(self.offset.y() + offset)
                    pos_delta.setY(offset)
                    rect.adjust(0, -offset, 0, offset)
                else:
                    rect.setHeight(self.snap(max(border, event.pos().y() - rect.y())))

            if rect != self.rect():
                self.prepareGeometryChange()
                self.setRect(rect)
                if pos_delta:
                    self.setPos(self.pos() + pos_delta)
        else:
            # use the default implementation for ItemIsMovable
            super().mouseMoveEvent(event)


    def mouseReleaseEvent(self, event: QGraphicsSceneMouseEvent) -> None:
        if self.isSelected() and self.is_moving:
            self.is_moving = False
            self.setZValue(self.saved_z_value)
            LOGGER.debug(f"Moving done {self.name}, restoring Z={self.saved_z_value}")
        self.selected_edge = Qt.Edges() # type: ignore  # noqa: PGH003
        super().mouseReleaseEvent(event)
        last_pos = event.lastScenePos()
        scene = self.scene()

        # TODO: What does 'deciveTransform' mean...
        items = scene.items( last_pos, order=Qt.SortOrder.AscendingOrder, deviceTransform=self.sceneTransform())

        # Filter out items we can actually have as a parent
        items = [x for x in items if isinstance(x, StateItem)]

        if self not in items:
            print("Self not in list..")
            return
        items.remove(self)


        if len(items) == 0:
            # Seems a bit hackis but just updating with setParentItem does not work.
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

    def hoverMoveEvent(self, event: QGraphicsSceneHoverEvent) -> None:
        edges = self.get_edges(event.pos())
        if not edges:
            self.unsetCursor()
        elif edges in (Qt.Edge.TopEdge | Qt.Edge.LeftEdge, Qt.Edge.BottomEdge | Qt.Edge.RightEdge):
            self.setCursor(Qt.CursorShape.SizeFDiagCursor)
        elif edges in (Qt.Edge.BottomEdge | Qt.Edge.LeftEdge, Qt.Edge.TopEdge | Qt.Edge.RightEdge):
            self.setCursor(Qt.CursorShape.SizeBDiagCursor)
        elif edges in (Qt.Edge.LeftEdge, Qt.Edge.RightEdge):
            self.setCursor(Qt.CursorShape.SizeHorCursor)
        else:
            self.setCursor(Qt.CursorShape.SizeVerCursor)

    def paint( self, painter: QPainter, option: QStyleOptionGraphicsItem, widget: QWidget | None = None) -> None:  # noqa: ARG002
        color = Qt.GlobalColor.green if self.isSelected() else Qt.GlobalColor.gray
        path = QPainterPath()
        path.addRoundedRect(self.rect(), 5, 5)
        painter.fillPath(path, QBrush(color))
        painter.setPen(self.pen())
        painter.drawPath(path)

class UfsmScene(QGraphicsScene):
    grid_pen = QPen(QColor(0x3C, 0x38, 0x36))

    def __init__(self, parent: QObject) -> None:
        super().__init__(parent)
        bg = QColor(0x28, 0x28, 0x28)
        self.bg_brush = QBrush(bg)

    # Here we can capture mouse press/release and key press/release events
    # and feed into a small state machine for drawing control. We can choose
    # to not send the events further down to "Items" by not calling the
    # super class.
    def mousePressEvent(self, event: QGraphicsSceneMouseEvent) -> None:
        super().mousePressEvent(event)

    def keyPressEvent(self, event: QKeyEvent) -> None:
        super().keyPressEvent(event)
        LOGGER.debug("UfsmScene key: %i", event.key())
        if Qt.Key.Key_A == event.key():
            LOGGER.debug("A!")
        if Qt.Key.Key_Escape == event.key():
            LOGGER.debug("Esc")

    def drawBackground(self, painter: QPainter, rect: QRectF | QRect) -> None:
        painter.fillRect(rect, self.bg_brush)
        painter.translate(0.5, 0.5)
        painter.setPen(self.grid_pen)

        x, y, right, bottom = rect.toRect().getCoords() # type: ignore  # noqa: PGH003
        top = y
        left = x
        step = UFSM_GRID_SNAP

        yrest = y % step
        if yrest:
            y += step - yrest
        for vline in range(y, bottom, step):
            painter.drawLine(left, vline, right, vline)

        xrest = x % step
        if xrest:
            x += step - xrest
        for hline in range(x, right, step):
            painter.drawLine(hline, top, hline, bottom)


class UfsmView(QGraphicsView):
    is_scrolling = False

    def __init__(self, scene: QGraphicsScene, parent: QWidget) -> None:
        super().__init__(parent)
        self.setScene(scene)
        self.setTransformationAnchor(QGraphicsView.ViewportAnchor.NoAnchor)
        self.setResizeAnchor(QGraphicsView.ViewportAnchor.NoAnchor)
        self.setVerticalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        self.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        self.setFrameShape(QFrame.Shape.NoFrame)
        self.setRenderHints(QPainter.RenderHint.Antialiasing |
                            QPainter.RenderHint.SmoothPixmapTransform)
        self.setSceneRect(-32000, -32000, 64000, 64000)

    def wheelEvent(self, event: QWheelEvent) -> None:
        factor = SCALE_FACTOR
        if event.angleDelta().y() < 0:
            factor = 1 / SCALE_FACTOR

        view_pos = QPoint(int(event.position().x()), int(event.position().y()))
        scene_pos = self.mapToScene(view_pos)
        self.scale(factor, factor)
        self.centerOn(scene_pos)
        delta = self.mapToScene(view_pos) - self.mapToScene(self.viewport().rect().center())
        self.centerOn(scene_pos - delta)
        event.accept()

    def mousePressEvent(self, event: QMouseEvent) -> None:
        if event.button() == Qt.MouseButton.RightButton:
            self.is_scrolling = True
            self.viewport().setCursor(Qt.CursorShape.ClosedHandCursor)
            self.scrollPos = event.position()
        else:
            super().mousePressEvent(event)

    def mouseReleaseEvent(self, event: QMouseEvent) -> None:
        if self.is_scrolling:
            self.is_scrolling = False
            self.viewport().unsetCursor()
        super().mouseReleaseEvent(event)

    def mouseMoveEvent(self, event: QMouseEvent) -> None:
        if self.is_scrolling:
            new_pos = event.position()
            delta = new_pos - self.scrollPos
            t = self.transform()
            self.translate(delta.x() / t.m11(), delta.y() / t.m22())
            self.scrollPos = new_pos
        else:
            super().mouseMoveEvent(event)
