/*
 * Copyright (C) 2017 - present Instructure, Inc.
 *
 * This file is part of Canvas.
 *
 * Canvas is free software: you can redistribute it and/or modify it under
 * the terms of the GNU Affero General Public License as published by the Free
 * Software Foundation, version 3 of the License.
 *
 * Canvas is distributed in the hope that it will be useful, but WITHOUT ANY
 * WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR
 * A PARTICULAR PURPOSE. See the GNU Affero General Public License for more
 * details.
 *
 * You should have received a copy of the GNU Affero General Public License along
 * with this program. If not, see <http://www.gnu.org/licenses/>.
 */

import changeCase from 'change-case'
import {AnimatableRegistry} from './animatable-registry'
import {Animator} from './animator'
import {AnimationCollection} from './animation-collection'
import {specialFallbackFocusId} from './util'
import {daysToItems} from '../utilities/daysUtils'
import {srAlert} from '../utilities/alertUtils'
import {useScope as createI18nScope} from '@canvas/i18n'
import {setNaiAboveScreen} from '../actions'

const I18n = createI18nScope('planner')

export class DynamicUiManager {
  static defaultOptions = {
    plannerActive: () => false,
    animator: new Animator(),
    document,
    actionsToAnimations: AnimationCollection.actionsToAnimations,
  }

  constructor(optsParam = {}) {
    const opts = {...DynamicUiManager.defaultOptions, ...optsParam}
    this.plannerActive = opts.plannerActive
    this.animator = opts.animator
    this.document = opts.document
    this.animatableRegistry = new AnimatableRegistry()
    this.animationCollection = new AnimationCollection(this, opts.actionsToAnimations)
    this.animationPlan = {}
    this.plannerHeaderId = ''
    this.newActivityButtonId = ''
  }

  setOffsetElementIds(plannerHeaderId, newActivityButtonId) {
    this.plannerHeaderId = plannerHeaderId
    this.newActivityButtonId = newActivityButtonId
  }

  getStickyOffset() {
    let offset = 0
    if (this.plannerHeaderId) {
      const elem = this.getDocument().getElementById(this.plannerHeaderId)
      if (elem) {
        const rect = elem.getBoundingClientRect()
        offset = rect.bottom
      }
    }
    return offset
  }

  getAdditionalOffset() {
    let offset = 0
    if (this.newActivityButtonId) {
      const elem = this.getDocument().getElementById(this.newActivityButtonId)
      if (elem) {
        const rect = elem.getBoundingClientRect()
        offset = rect.height
      }
    }
    return offset
  }

  setStore(store) {
    this.store = store
  }

  setApp(app) {
    this.app = app
  }

  totalOffset() {
    return this.getStickyOffset() + this.getAdditionalOffset()
  }

  focusFallback(type) {
    const component = this.animatableRegistry.getComponent(type, specialFallbackFocusId(type))
    if (component) this.animator.focusElement(component.component.getFocusable())
  }

  getRegistry() {
    return this.animatableRegistry
  }

  getAnimator() {
    return this.animator
  }

  getStore() {
    return this.store
  }

  getApp() {
    return this.app
  }

  getDocument() {
    return this.document
  }

  static expectedActionsFor(animationClass) {
    return AnimationCollection.expectedActionsFor(animationClass)
  }

  // If you want to register a fallback focus component when all the things in a list are deleted,
  // register that component with a -1 index and a special unique componentId that looks like
  // this: `~~~${registryName}-fallback-focus~~~` where registryName is one of the
  // AnimatableRegistry collections.
  registerAnimatable = (type, component, index, componentIds) => {
    this.animatableRegistry.register(type, component, index, componentIds)
  }

  deregisterAnimatable = (type, component, componentIds) => {
    this.animatableRegistry.deregister(type, component, componentIds)
  }

  clearAnimationPlan() {
    this.animationPlan = this.animationPlan.nextAnimationPlan || {}
  }

  uiStateUnchanged(_action) {
    // pretend there was a ui update so the animations can respond to actions that don't change
    // the redux state.
    if (this.plannerActive()) {
      this.animationCollection.uiWillUpdate()
      this.animationCollection.uiDidUpdate()
    }
  }

  preTriggerUpdates = () => {
    if (this.plannerActive()) this.animationCollection.uiWillUpdate()
  }

  triggerUpdates = () => {
    if (this.plannerActive()) this.animationCollection.uiDidUpdate()

    const animationPlan = this.animationPlan
    if (!animationPlan.ready) return

    if (this.animationPlan.focusOpportunity) {
      this.triggerFocusOpportunity()
    }

    this.clearAnimationPlan()
  }

  triggerFocusOpportunity() {
    const oppToFocus = this.animatableRegistry.getComponent(
      'opportunity',
      this.animationPlan.focusOpportunity,
    )
    if (oppToFocus == null) return
    this.animator.focusElement(oppToFocus.component.getFocusable(this.animationPlan.trigger))
  }

  handleScrollPositionChange() {
    // if the button is not being shown, don't show it until an nai is
    // actually above the window, not just under the header. This prevents
    // bouncing of the button visibility that happens as we scroll to new
    // activity because showing and hiding the button changes the document
    // height, which changes the scroll position.
    let naiThreshold = this.getStickyOffset()
    if (!this.store.getState().ui.naiAboveScreen) {
      naiThreshold = 0
    }

    const newActivityIndicators = this.animatableRegistry.getAllNewActivityIndicatorsSorted()
    let naiAboveScreen = false
    if (newActivityIndicators.length > 0) {
      const naiScrollable = newActivityIndicators[0].component.getScrollable()
      naiAboveScreen = naiScrollable.getBoundingClientRect().top < naiThreshold
    }

    // just to make sure we avoid dispatching on every scroll position change
    if (this.store.getState().ui.naiAboveScreen !== naiAboveScreen) {
      this.store.dispatch(setNaiAboveScreen(naiAboveScreen))
    }
  }

  handleAction = action => {
    if (this.plannerActive()) this.animationCollection.acceptAction(action)

    const handlerSuffix = changeCase.pascal(action.type)
    const handlerName = `handle${handlerSuffix}`
    const handler = this[handlerName]
    if (handler) handler(action)
  }

  alertLoading = () => {
    srAlert(I18n.t('loading'))
  }

  handleStartLoadingItems = this.alertLoading

  handleGettingFutureItems = this.alertLoading

  handleGettingPastItems = this.alertLoading

  handleGotDaysSuccess = action => {
    const newDays = action.payload.internalDays
    const newItems = daysToItems(newDays)
    srAlert(
      I18n.t(
        {
          zero: '0 items loaded',
          one: '1 item loaded',
          other: '%{count} items loaded',
        },
        {
          count: newItems.length,
        },
      ),
    )
  }

  handleStartLoadingGradesSaga = _action => {
    srAlert(I18n.t('Loading Grades'))
  }

  handleGotGradesSuccess = _action => {
    srAlert(I18n.t('Grades Loaded'))
  }

  handleDismissedOpportunity = action => {
    // for graded discussions and quizzes, the assignment_id is different
    // and is what is registered
    const doomedComponentId = action.payload.assignment_id || action.payload.plannable_id
    this.planDeletedComponent('opportunity', doomedComponentId)
  }

  // Note that this is actually called before reducers and therefore before the doomed item has
  // actually been removed from the state.
  planDeletedComponent(doomedComponentType, doomedComponentId) {
    const sortedComponents = this.sortedComponentsFor(doomedComponentType)
    const doomedComponentIndex = sortedComponents.findIndex(
      c => c.componentIds[0] === doomedComponentId,
    )
    const newComponentIndex = this.findFocusIndexAfterDelete(sortedComponents, doomedComponentIndex)
    const animationPlanFocusField = changeCase.camelCase(`focus-${doomedComponentType}`)
    if (newComponentIndex != null) {
      this.animationPlan[animationPlanFocusField] =
        sortedComponents[newComponentIndex].componentIds[0]
    } else {
      this.animationPlan[animationPlanFocusField] = specialFallbackFocusId(doomedComponentType)
    }
    this.animationPlan.trigger = 'delete'
    this.animationPlan.ready = true
  }

  sortedComponentsFor(componentType) {
    switch (componentType) {
      case 'item':
        return this.animatableRegistry.getAllItemsSorted()
      case 'opportunity':
        return this.animatableRegistry.getAllOpportunitiesSorted()
      default:
        throw new Error(`unrecognized deleted component type: ${componentType}`)
    }
  }

  // Note that this finds the new focusable index at its current position, not at its new position
  // after the doomed item is removed. This allows retrieval of the new focusable before the doomed
  // item is removed.
  findFocusIndexAfterDelete(sortedFocusables, doomedFocusableIndex) {
    const newFocusableIndex = doomedFocusableIndex - 1
    if (newFocusableIndex < 0) return null
    return newFocusableIndex
  }
}
