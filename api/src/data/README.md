# Reference data: states and LGAs

`ng-areas.json` lists Nigeria's 36 states, the FCT and 774 local government areas. It is generated from the MIT-licensed npm
package `nigeria-lga-data` (names only). Before use it was checked: every state's LGA count matches the official figure
(total 774), the Benue and Nasarawa lists match an independent hand-typed list, and there are no duplicate or odd names.

`web/areas.json` is a copy for the website's dropdown suggestions. Keep the two files identical (a unit test checks this).
To correct a name, edit both files. Names are used for validating and suggesting only; areas typed by staff are never rejected.
