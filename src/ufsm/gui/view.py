from __future__ import annotations

import logging

from PySide6.QtCore import QPoint, Qt
from PySide6.QtGui import (
    QMouseEvent,
    QPainter,
    QWheelEvent,
)
from PySide6.QtWidgets import (
    QFrame,
    QGraphicsScene,
    QGraphicsView,
    QWidget,
)

from .const import UFSM_SCALE_FACTOR

# TODO: Adjust grid depending on zoom level
# TODO: Clamp zoom levels to a min/max

LOGGER = logging.getLogger(__name__)

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
        factor = UFSM_SCALE_FACTOR
        if event.angleDelta().y() < 0:
            factor = 1 / UFSM_SCALE_FACTOR

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
