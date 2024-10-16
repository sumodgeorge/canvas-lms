/*
 * Copyright (C) 2021 - present Instructure, Inc.
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

import I18n from '@canvas/i18n'
import moment from 'moment'
import timezone from 'timezone'
import en_US from 'timezone/en_US'
import parseDateTimeWithMoment, {
  specifiesTimezone,
  toRFC3339WithoutTZ,
} from 'date-time-moment-parser'

const initialState = Object.freeze({
  // a timezone instance configured for the user's current timezone and locale
  //
  //     import timezone from 'timezone'
  //     import Denver from 'timezone/America/Denver'
  //     import french from 'timezone/fr_FR'
  //
  //     const tz = timezone('America/Denver', Denver, 'fr_FR', french)
  //
  // tz: timezone(en_US, 'en_US', 'UTC'),
  tz: timezone(en_US, 'en_US', 'UTC'),

  // a mapping of timezones (e.g. America/Denver) to their timezone data (e.g.
  // import Denver from "timezone/America/Denver") that is used when formatting
  // to a timezone different than the default
  tzData: {},

  // used for parsing datetimes when timezone is unable to parse a value
  momentLocale: 'en',
})

const state = Object.assign({}, initialState)

export function configure({ tz, tzData, momentLocale }) {
  const previousState = Object.assign({}, state)

  state.tz = tz || initialState.tz
  state.tzData = tzData || initialState.tzData
  state.momentLocale = momentLocale || initialState.momentLocale

  return previousState
}

export function parse(value) {
  const { tz, momentLocale } = state

  // hard code '' and null as unparseable
  if (value === '' || value === null || value === undefined) {
    return null
  }

  // we don't want to use tz for parsing any string that doesn't look like a
  // datetime string
  if (typeof value !== 'string' || value.match(/[-:]/)) {
    const epoch = tz(value)

    if (typeof epoch === 'number') {
      return new Date(epoch)
    }
  }

  // try with moment
  if (typeof value === 'string') {
    let m = parseDateTimeWithMoment(value, momentLocale)

    if (m && !specifiesTimezone(m)) {
      const fudged = tz(toRFC3339WithoutTZ(m))

      m = moment(new Date(fudged))
      m.locale(momentLocale)
    }

    if (m) {
      return m.toDate()
    }
  }

  return null
}

// format a date value (parsing it if necessary). returns null for parse
// failure on the value or an unrecognized format string.
export function format(value, inputFormat, otherZone) {
  const { tzData } = state
  const usingOtherZone = arguments.length === 3 && otherZone

  let tz = state.tz
  if (usingOtherZone) {
    if (!(otherZone in tzData)) {
      console.warn(
        `You are asking to format DateTime into a timezone that is not supported -- ${otherZone}`
      )
      return null
    }
    tz = tz(tzData[otherZone])
  }
  // make sure we have a good value first
  const datetime = parse(value)
  if (datetime === null) return null

  const localizedFormat = adjustFormat(inputFormat)

  // try and apply the format string to the datetime. if it succeeds, we'll
  // get a string; otherwise we'll get the (non-string) date back.
  let formatted = null

  if (usingOtherZone) {
    formatted = tz(datetime, localizedFormat, otherZone)
  } else {
    formatted = tz(datetime, localizedFormat)
  }

  if (typeof formatted !== 'string') return null
  return formatted
}

export function adjustFormat(format) {
  // translate recognized 'date.formats.*' and 'time.formats.*' to
  // appropriate format strings according to locale.
  if (format.match(/^(date|time)\.formats\./)) {
    const localeFormat = I18n.lookup(format)
    if (localeFormat) {
      // in the process, turn %l, %k, and %e into %-l, %-k, and %-e
      // (respectively) to avoid extra unnecessary space characters
      //
      // javascript doesn't have lookbehind, so do the fixing on the reversed
      // string so we can use lookahead instead. the funky '(%%)*(?!%)' pattern
      // in all the regexes is to make sure we match (once unreversed), e.g.,
      // both %l and %%%l (literal-% + %l) but not %%l (literal-% + l).
      format = localeFormat
        .split('')
        .reverse()
        .join('')
        .replace(/([lke])(?=%(%%)*(?!%))/, '$1-')
        .split('')
        .reverse()
        .join('')
    }
  }

  // some locales may not (according to bigeasy's localization files) use
  // an am/pm distinction, but could then be incorrectly used with 12-hour
  // format strings (e.g. %l:%M%P), whether by erroneous format strings in
  // canvas' localization files or by unlocalized format strings. as a
  // result, you might get 3am and 3pm both formatting to the same value.
  // to prevent this, 12-hour indicators with an am/pm indicator should be
  // promoted to the equivalent 24-hour indicator when the locale defines
  // %P as an empty string. ("reverse, look-ahead, reverse" pattern for
  // same reason as above)
  format = format
    .split('')
    .reverse()
    .join('')
  if (
    !hasMeridian() &&
    ((format.match(/[lI][-_]?%(%%)*(?!%)/) && format.match(/p%(%%)*(?!%)/i)) ||
      format.match(/r[-_]?%(%%)*(?!%)/))
  ) {
    format = format.replace(/l(?=[-_]?%(%%)*(?!%))/, 'k')
    format = format.replace(/I(?=[-_]?%(%%)*(?!%))/, 'H')
    format = format.replace(/r(?=[-_]?%(%%)*(?!%))/, 'T')
  }
  format = format
    .split('')
    .reverse()
    .join('')

  return format
}

export function hasMeridian() {
  const { tz } = state

  return tz(new Date(), '%P') !== ''
}

export function useMeridian() {
  if (!hasMeridian()) return false
  const tiny = I18n.lookup('time.formats.tiny')
  return tiny && tiny.match(/%-?l/)
}

// apply any number of non-format directives to the value (parsing it if
// necessary). return null for parse failure on the value or if one of the
// directives was mistakenly a format string. returns the modified Date
// otherwise. typical directives will be for date math, e.g. '-3 days'.
// non-format unrecognized directives are ignored.
export function shift(value) {
  const { tz } = state

  // make sure we have a good value first
  const datetime = parse(value)
  if (datetime === null) return null

  // no application strings given? just regurgitate the input (though
  // parsed now).
  if (arguments.length === 1) return datetime

  // try and apply the directives to the datetime. if one was a format
  // string (unacceptable) we'll get a (non-integer) string back.
  // otherwise, we'll get a new timestamp integer back (even if some
  // unrecognized non-format applications were ignored).
  const args = [datetime].concat([].slice.apply(arguments, [1]))
  const timestamp = tz(...args)
  if (typeof timestamp !== 'number') return null
  return new Date(timestamp)
}

export function isMidnight(date) {
  if (date === null) {
    return false
  }
  return format(date, '%R') === '00:00'
}

export function changeToTheSecondBeforeMidnight(date) {
  return parse(format(date, '%F 23:59:59'))
}

export function setToEndOfMinute(date) {
  return parse(format(date, '%F %R:59'))
}

// finds the given time of day on the given date ignoring dst conversion and such.
// e.g. if time is 2016-05-20 14:00:00 and date is 2016-03-17 23:59:59, the result will
// be 2016-03-17 14:00:00
export function mergeTimeAndDate(time, date) {
  return parse(format(date, '%F ') + format(time, '%T'))
}

export default {
  adjustFormat,
  changeToTheSecondBeforeMidnight,
  format,
  hasMeridian,
  isMidnight,
  mergeTimeAndDate,
  parse,
  setToEndOfMinute,
  shift,
  useMeridian,
}
