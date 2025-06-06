/*
 * Copyright (C) 2016 - present Instructure, Inc.
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

// this is called by SpeedGrader to enable communication
// between quizzesNext LTI tool and SpeedGrader
// and modify normal speedGrader behavior to be more compatible
// with our LTI tool

// it sets up event listeners for postMessage communication
// from the LTI tool

// registerCb replaces the base speedgrader submissionChange callback
// with whatever callback is passed in as an argument

// refreshGradesCb executes the normal speedGrader refresh grades
// actions, plus whatever callback is passed in as an argument

import type {Submission} from '../../api.d'
import $ from 'jquery'

// @ts-expect-error
function sendPostMessage($iframe_holder, message) {
  const contentWindow = $iframe_holder.children()[0]?.contentWindow
  if (contentWindow) {
    contentWindow.postMessage(message, '*')
  }
}

// @ts-expect-error
function setup(EG, $iframe_holder, registerCb, refreshGradesCb, speedGraderWindow = window) {
  // @ts-expect-error
  function quizzesNextChange(submission) {
    EG.refreshSubmissionsToView()
    if (submission && submission.submission_history) {
      const lastIndex = submission.submission_history.length - 1
      // set submission to selected in dropdown
      $('#submission_to_view option:eq(' + lastIndex + ')').prop('selected', true)
    }
    EG.showGrade()
    EG.showDiscussion()
    EG.showRubric()
    EG.updateStatsInHeader()
    EG.refreshFullRubric()
    EG.setGradeReadOnly(true)
  }

  function retryRefreshGrades(
    submission: Submission,
    originalSubmission: Submission,
    numRequests: number,
  ) {
    const maxRequests = 20
    if (numRequests >= maxRequests) return false
    if (!originalSubmission.graded_at) return !submission.graded_at
    if (!submission.graded_at) return true

    return Date.parse(submission.graded_at) <= Date.parse(originalSubmission.graded_at)
  }

  // @ts-expect-error
  // gets the submission from the speed_grader.js
  // function that will call this
  function postChangeSubmissionMessage(submission) {
    const message = {subject: 'canvas.speedGraderSubmissionChange', submission}
    sendPostMessage($iframe_holder, message)
    EG.showSubmissionDetails()
    quizzesNextChange(submission)
  }

  // @ts-expect-error
  function onMessage(e) {
    const message = e.data
    const prevButton = document.getElementById('prev-student-button')

    if (
      message &&
      message.subject &&
      message.subject.startsWith('SG.switchToFullContext&entryId=')
    ) {
      return EG.renderSubmissionPreview(
        'iframe',
        'discussion_view_with_context',
        message.subject.split('=')[1],
      )
    }
    switch (message.subject) {
      case 'quizzesNext.register':
        EG.setGradeReadOnly(true)
        return registerCb(postChangeSubmissionMessage, message.payload || {singleLtiLaunch: true})
      case 'quizzesNext.submissionUpdate':
        return refreshGradesCb(quizzesNextChange, retryRefreshGrades, 1000)
      case 'quizzesNext.previousStudent':
        return EG.prev()
      /* falls through */
      case 'quizzesNext.nextStudent':
        return EG.next()
      /* falls through */
      case 'SG.focusPreviousStudentButton':
        if (prevButton) {
          return prevButton.focus()
        }
      /* falls through */
      case 'SG.switchToIndividualPosts':
        EG.renderSubmissionPreview('iframe', 'discussion_view_no_context')
        EG.clearDiscussionsNavigation()
        return
      /* falls through */
      case 'SG.switchToFullContext':
        EG.renderSubmissionPreview('iframe', 'discussion_view_with_context')
        EG.renderDiscussionsNavigation('discussion_view_with_context')
        return
      /* falls through */
      case 'SG.commentKeyPress':
        EG.addCommentTextAreaFocus()
        return
      /* falls through */
      case 'SG.gradeKeyPress':
        EG.gradeFocus()
        return
      /* falls through */
    }
  }

  speedGraderWindow.addEventListener('message', onMessage)

  // expose for testing
  return {
    onMessage,
    postChangeSubmissionMessage,
    quizzesNextChange,
  }
}

// @ts-expect-error
export function postGradeByQuestionChangeMessage($iframe_holder, enabled) {
  const message = {subject: 'canvas.speedGraderGradeByQuestionChange', enabled}
  sendPostMessage($iframe_holder, message)
}

// @ts-expect-error
export function postChangeSubmissionVersionMessage($iframe_holder, submission) {
  const message = {
    subject: 'canvas.speedGraderSubmissionChange',
    submission: {...submission, external_tool_url: submission.url},
  }
  const contentWindow = $iframe_holder.children()[0]?.contentWindow
  if (contentWindow) {
    contentWindow.postMessage(message, '*')
  }
}

export default {
  setup,
  postGradeByQuestionChangeMessage,
  postChangeSubmissionVersionMessage,
}
