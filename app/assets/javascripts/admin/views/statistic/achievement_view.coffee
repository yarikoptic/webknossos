_          = require("lodash")
Marionette = require("backbone.marionette")

class AchievementView extends Marionette.ItemView

  template : _.template("""
    <h3>Achievements</h3>
    <table class="table">
      <tbod>
        <tr>
          <td>Number of Annotations</td>
          <td><%- numberOfAnnotations %></td>
        </tr>
        <tr>
          <td>Number of Users</td>
          <td><%- numberOfUsers %></td>
        </tr>
      </tbody>
    </table>
  """)

module.exports = AchievementView
