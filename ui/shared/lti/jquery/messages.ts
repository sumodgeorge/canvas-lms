/*
 * Copyright (C) 2018 - present Instructure, Inc.
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

/* eslint no-console: 0 */

import uuid from 'uuid'
import {
  NAVIGATION_MESSAGE as MENTIONS_NAVIGATION_MESSAGE,
  INPUT_CHANGE_MESSAGE as MENTIONS_INPUT_CHANGE_MESSAGE,
  SELECTION_MESSAGE as MENTIONS_SELECTION_MESSAGE,
} from '@canvas/rce/plugins/canvas_mentions/constants'
import type {LtiMessageHandler} from './lti_message_handler'
import buildResponseMessages from './response_messages'
import {getKey, hasKey, deleteKey} from './util'
import {
  SUBJECT_ALLOW_LIST,
  SUBJECT_IGNORE_LIST,
  type SubjectId,
  SCOPE_REQUIRED_SUBJECTS,
} from './constants'

// page-global storage for data relevant to LTI postMessage events
const ltiState: {
  tray?: {refreshOnClose?: boolean}
  fullWindowProxy?: Window | null
} = {}

const isAllowedSubject = (subject: unknown): subject is SubjectId =>
  typeof subject === 'string' && (SUBJECT_ALLOW_LIST as ReadonlyArray<string>).includes(subject)

const isIgnoredSubject = (subject: unknown): subject is SubjectId =>
  typeof subject === 'string' && (SUBJECT_IGNORE_LIST as ReadonlyArray<string>).includes(subject)

const isUnsupportedInRCE = (subject: unknown): subject is SubjectId =>
  typeof subject === 'string' &&
  (['lti.enableScrollEvents', 'lti.scrollToTop'] as ReadonlyArray<string>).includes(subject)

/**
 * Checks that the tool for the given tool_id has the required
 * scopes for the given message subject.
 * If the subject is not in the SCOPE_REQUIRED_SUBJECTS object,
 * it is assumed to be allowed for all tools.
 */
const toolIsAuthorized = (subject: string, tool_id: string) => {
  const tool_scopes = ENV.LTI_TOOL_SCOPES?.[tool_id]
  if (SCOPE_REQUIRED_SUBJECTS[subject]) {
    return SCOPE_REQUIRED_SUBJECTS[subject].some(scope => tool_scopes?.includes(scope))
  } else {
    return true
  }
}

const isObject = (u: unknown): u is object => {
  return typeof u === 'object'
}

/**
 * Returns true if the data from a message event is associated with a dev tool
 * @param data - The `data` attribute from a message event
 */
const isDevtoolMessageData = (data: unknown): boolean => {
  return (
    isObject(data) &&
    ((hasKey('source', data) &&
      typeof data.source === 'string' &&
      data.source.includes('react-devtools')) ||
      (hasKey('isAngularDevTools', data) && !!data.isAngularDevTools))
  )
}

/**
 * A mapping of lti message id to a function that "handles" the message
 * The values are functions to preserve the asynchronous loading of
 * code that was present in the previous style. It may not be necessary.
 */
const handlers: Record<
  (typeof SUBJECT_ALLOW_LIST)[number],
  () => Promise<{default: LtiMessageHandler<any>}>
> = {
  'lti.close': () => import(`./subjects/lti.close`),
  'lti.enableScrollEvents': () => import(`./subjects/lti.enableScrollEvents`),
  'lti.fetchWindowSize': () => import(`./subjects/lti.fetchWindowSize`),
  'lti.frameResize': () => import(`./subjects/lti.frameResize`),
  'lti.hideRightSideWrapper': () => import(`./subjects/lti.hideRightSideWrapper`),
  'lti.removeUnloadMessage': () => import(`./subjects/lti.removeUnloadMessage`),
  'lti.resourceImported': () => import(`./subjects/lti.resourceImported`),
  'lti.screenReaderAlert': () => import(`./subjects/lti.screenReaderAlert`),
  'lti.scrollToTop': () => import(`./subjects/lti.scrollToTop`),
  'lti.setUnloadMessage': () => import(`./subjects/lti.setUnloadMessage`),
  'lti.showAlert': () => import(`./subjects/lti.showAlert`),
  'lti.showModuleNavigation': () => import(`./subjects/lti.showModuleNavigation`),
  'lti.capabilities': () => import(`./subjects/lti.capabilities`),
  'lti.get_data': () => import(`./subjects/lti.get_data`),
  'lti.put_data': () => import(`./subjects/lti.put_data`),
  'lti.getPageContent': () => import(`./subjects/lti.getPageContent`),
  'lti.getPageSettings': () => import(`./subjects/lti.getPageSettings`),
  requestFullWindowLaunch: () => import(`./subjects/requestFullWindowLaunch`),
  toggleCourseNavigationMenu: () => import(`./subjects/toggleCourseNavigationMenu`),
  showNavigationMenu: () => import(`./subjects/showNavigationMenu`),
  hideNavigationMenu: () => import(`./subjects/hideNavigationMenu`),
}

/**
 * Handles 'message' events for LTI-related messages from LTI tools
 * @param e
 * @returns
 */
async function ltiMessageHandler(e: MessageEvent<unknown>) {
  if (isDevtoolMessageData(e.data)) {
    return false
  }

  let message: unknown
  try {
    message = typeof e.data === 'string' ? JSON.parse(e.data) : e.data
  } catch (err) {
    // unparseable message may not be meant for our handlers
    return false
  }

  if (typeof message !== 'object' || message === null) {
    // unparseable message may not be meant for our handlers
    return false
  }

  // tools launched from within the RCE are wrapped in an iframe
  // that will forward postMessages, so that the tool can have
  // the sibling forwarder frame for Platform Storage, and thus
  // may not respond correctly to some message types.
  const isFromRce = !!getKey('in_rce', message)
  deleteKey('in_rce', message)

  const targetWindow = e.source as Window

  // look at messageType for backwards compatibility
  const subject = getKey('subject', message) || getKey('messageType', message)
  const responseMessages = buildResponseMessages({
    targetWindow,
    origin: e.origin,
    subject,
    message_id: getKey('message_id', message),
    sourceToolInfo: getKey('sourceToolInfo', message),
  })

  if (subject === undefined || isIgnoredSubject(subject) || responseMessages.isResponse(e)) {
    // These messages are handled elsewhere
    return false
  } else if (!isAllowedSubject(subject)) {
    responseMessages.sendUnsupportedSubjectError()
    return false
  } else if (!toolIsAuthorized(subject, e.origin)) {
    responseMessages.sendUnauthorizedError()
    return false
  } else if (isUnsupportedInRCE(subject) && isFromRce) {
    // Since tools launched from within an active RCE are inside a nested
    // iframe, some subjects can't find the tool frame and so are not supported
    responseMessages.sendUnsupportedSubjectError('Not supported inside Rich Content Editor')
    return false
  } else {
    try {
      const callback = () => {
        const subject_callbacks = callbacks[subject]
        if (subject_callbacks) {
          Object.values(subject_callbacks).forEach(cb => cb())
        }
      }
      const handlerModule = await handlers[subject]()
      const hasSentResponse = handlerModule.default({
        message,
        event: e,
        responseMessages,
        callback,
      })
      if (!hasSentResponse) {
        responseMessages.sendSuccess()
      }
      if (
        window.ENV.DATA_COLLECTION_ENDPOINT &&
        typeof window.ENV.DATA_COLLECTION_ENDPOINT === 'string'
      ) {
        fetch(window.ENV.DATA_COLLECTION_ENDPOINT, {
          method: 'PUT',
          mode: 'cors',
          credentials: 'omit',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify([
            {
              id: uuid.v4(),
              type: 'postmessage_usage',
              subject,
              origin: e.origin,
            },
          ]),
        })
      }
      return true
    } catch (error) {
      console.error(`Error loading or executing message handler for "${subject}": ${error}`)

      const message =
        isObject(error) && hasKey('message', error) && typeof error.message === 'string'
          ? error.message
          : undefined
      responseMessages.sendGenericError(message)
      return false
    }
  }
}

// Prevent duplicate listeners inside the same window
let hasListener = false

// Let any page define a callback for a given subject and placement
// Ex: close a modal when `lti.close` is received for a tool launched from `assignment_selection`
type PlacementCallbacks = Record<string, () => void>
const callbacks: Partial<Record<(typeof SUBJECT_ALLOW_LIST)[number], PlacementCallbacks>> = {}

function monitorLtiMessages() {
  // This should only be true when canvas is in an iframe (like for postMessage forwarding),
  // to prevent duplicate listeners across canvas windows.
  const shouldIgnoreLtiPostMessages: boolean = ENV?.IGNORE_LTI_POST_MESSAGES || false
  const cb = (e: MessageEvent<unknown>) => {
    if (e.data !== '') ltiMessageHandler(e)
  }
  if (!hasListener && !shouldIgnoreLtiPostMessages) {
    window.addEventListener('message', cb)
    hasListener = true
  }
}

/**
 * Hook into a given LTI postMessage handler and run an extra callback.
 * Example: close an on-page modal when `lti.close` is received.
 * Will run all callbacks registered for the given subject.
 *
 * @param subject An allowed LTI postMessage subject
 * @param placement A unique identifier for the tool launch placement
 * @param callback A function to execute when a postMessage with the given subject is received
 */
function callbackOnLtiPostMessage(
  subject: (typeof SUBJECT_ALLOW_LIST)[number],
  placement: string,
  callback: () => void,
) {
  callbacks[subject] ||= {}
  callbacks[subject][placement] = callback
}

/**
 * Remove an extra callback for a given LTI postMessage subject and placement.
 * Does not remove the default subject handler.
 *
 * @param subject An allowed LTI postMessage subject
 * @param placement A unique identifier for the tool launch placement
 */
function removeLtiPostMessageCallback(
  subject: (typeof SUBJECT_ALLOW_LIST)[number],
  placement: string,
) {
  if (callbacks[subject] && callbacks[subject][placement]) {
    delete callbacks[subject][placement]
  }
}

/**
 * Be informed when Canvas receives an `lti.close` postMessage,
 * and respond (usually by closing the tool launch modal).
 *
 * @param placement A unique identifier for the tool launch placement
 * @param callback A function to execute on `lti.close`
 * @returns A cleanup function to remove the callback
 */
function onLtiClosePostMessage(placement: string, callback: () => void) {
  callbackOnLtiPostMessage('lti.close', placement, callback)

  return () => removeLtiPostMessageCallback('lti.close', placement)
}

export {
  ltiState,
  ltiMessageHandler,
  monitorLtiMessages,
  callbackOnLtiPostMessage,
  removeLtiPostMessageCallback,
  onLtiClosePostMessage,
}
